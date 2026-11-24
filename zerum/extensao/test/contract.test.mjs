/**
 * TESTE DE CONTRATO: a extensão (JS puro, sem build) e o app (TypeScript) são dois programas que só compartilham um
 * protocolo. Aqui os dois lados são comparados — constantes, máquina de estados, política de cota — e as mensagens REAIS
 * produzidas pela extensão são validadas pelos esquemas zod do app. Se um lado mudar sem o outro, este arquivo quebra.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as E from '../lib/protocol.js';
import { toResponse } from '../content/site-relay.js';
import * as B from '../../src/lib/bridge/broker.ts';
import * as P from '../../src/lib/bridge/protocol.ts';
import { accountUsable, statusFromExtension, toFlowAccount } from '../../src/lib/bridge/status.ts';
import { PROJECT, ctx, deliverClip, makeEnv, order as brokerOrder } from './helpers.mjs';
import { createWorld, FLOW_CTX, sender, videoOrder } from './world.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('constantes e estados: extensão ⇄ app', () => {
  it('ações, prazo de 25 s, texto literal de "sem resposta" e nome do protocolo', () => {
    expect(E.BRIDGE_ACTIONS).toEqual([...P.BRIDGE_ACTIONS]);
    expect(E.BRIDGE_TIMEOUT_MS).toBe(P.BRIDGE_TIMEOUT_MS);
    expect(E.BRIDGE_TIMEOUT_MS).toBe(25_000);
    expect(E.ERR_NO_RESPONSE).toBe(P.ERR_NO_RESPONSE);
    expect(E.ERR_NO_RESPONSE).toBe('EXTENSAO_SEM_RESPOSTA; pedido preservado, não gerar outra vez');
    expect(E.PROTOCOL).toBe(P.BRIDGE_PROTOCOL);
    expect(E.BRIDGE_ACTIONS).not.toContain('connect'); // a troca de sessão da 001 não existe aqui
  });

  it('estados do broker e a TABELA de transições são idênticos (todos os 36 pares)', () => {
    expect(E.BROKER_STATES).toEqual([...B.BROKER_STATES]);
    for (const a of B.BROKER_STATES) {
      expect(E.isTerminal(a), `terminal ${a}`).toBe(B.isTerminal(a));
      expect(E.forbidsResubmit(a), `reenvio ${a}`).toBe(B.forbidsResubmit(a));
      for (const b of B.BROKER_STATES) expect(E.canTransition(a, b), `${a} → ${b}`).toBe(B.canTransition(a, b));
    }
  });

  it('cota: 429/QUOTA/COTA = 24 h; INCOMUM/UNUSUAL/RESOURCE_EXHAUSTED = 5 min — mesma classificação nos dois lados', () => {
    expect(E.QUOTA_PAUSE_MS).toBe(B.QUOTA_PAUSE_MS);
    expect(E.SOFT_PAUSE_MS).toBe(B.SOFT_PAUSE_MS);
    expect(E.QUOTA_PAUSE_MS).toBe(86_400_000);
    for (const kind of ['cota', 'incomum']) expect(E.pauseUntil(kind, 1000)).toBe(B.pauseUntil(kind, 1000));
    const table = [
      ['HTTP 429 too many', 'cota'],
      ['COTA_HTTP_429', 'cota'],
      ['COTA', 'cota'],
      ['COTA · You have reached your daily quota', 'cota'],
      ['PUBLIC_ERROR_DAILY_QUOTA_REACHED', 'cota'],
      ['PER_MODEL_DAILY_QUOTA', 'cota'],
      ['quota exceeded', 'cota'],
      ['RESOURCE_EXHAUSTED: quota', 'cota'], // a cota vence
      ['UNUSUAL_ACTIVITY', 'incomum'],
      ['INCOMUM', 'incomum'],
      ['RESOURCE_EXHAUSTED', 'incomum'],
      ['recaptcha evaluation failed → INCOMUM', 'incomum'],
      ['erro 4290', null],
      ['HTTP 1429', null],
      ['CONTEUDO_RECUSADO', null],
      ['FLOW_ERRO', null],
      ['CREDITOS_INSUFICIENTES', null],
      ['', null],
    ];
    for (const [text, want] of table) {
      expect(E.classifyRefusal(text), `ext "${text}"`).toBe(want);
      expect(B.classifyRefusal(text), `app "${text}"`).toBe(want);
    }
    // os códigos que a extensão EMITE para falhas do Flow são classificados como o app espera
    expect(E.classifyRefusal(E.ERROR_CODES.quota)).toBe('cota');
    expect(E.classifyRefusal(E.ERROR_CODES.unusual)).toBe('incomum');
    for (const c of [E.ERROR_CODES.credits, E.ERROR_CODES.policy, E.ERROR_CODES.generic]) expect(E.classifyRefusal(c)).toBeNull();
  });

  it('o broker usa as mesmas regras de cota que o app (pausa efetiva de 24 h / 5 min, por texto de erro)', async () => {
    for (const [error, expected] of [['COTA_HTTP_429', E.QUOTA_PAUSE_MS], ['UNUSUAL_ACTIVITY', E.SOFT_PAUSE_MS]]) {
      const env = makeEnv();
      await env.broker.heartbeat({ context: ctx(), worker: 'w1', capacity: 1 });
      await env.broker.enqueue(brokerOrder());
      const o = (await env.broker.heartbeat({ context: ctx(), worker: 'w1', capacity: 1 })).orders[0];
      const hit = env.clock.t;
      await env.broker.heartbeat({ context: ctx(), worker: 'w1', events: [{ id: o.id, lease: o.lease, eventId: 'e', state: 'failed', error }] });
      expect((await env.broker.list())[0].cooldownUntil - hit).toBe(expected);
    }
  });

  it('todo código de erro do broker que a bomba (app) trata existe de verdade no broker da extensão', () => {
    const src = fs.readFileSync(path.join(root, 'background', 'broker.js'), 'utf8');
    const pump = fs.readFileSync(path.join(root, '..', 'src', 'lib', 'bridge', 'pump.ts'), 'utf8');
    const used = [...new Set([...pump.matchAll(/'([A-Z][A-Z_]{8,})'/g)].map((m) => m[1]))].filter((c) => /^(CONTA_|ORDEM_|TENTATIVA_|JOB_|CHAVE_)/.test(c));
    expect(used.length).toBeGreaterThanOrEqual(6);
    for (const code of used) expect(src, code).toContain(`'${code}'`);
  });
});

describe('mensagens reais da extensão validadas pelos esquemas do app', () => {
  it('respostas do relay: result, erro (com code/retryable/retryAt) e push de saúde', () => {
    expect(P.BridgeResponseSchema.safeParse(toResponse('i', 'get', { result: { a: 1 } })).success).toBe(true);
    expect(P.BridgeResponseSchema.safeParse(toResponse('i', 'get', { result: undefined })).success).toBe(true);
    const err = P.BridgeResponseSchema.safeParse(toResponse('i', 'enqueue', { error: 'CONTA_EM_PAUSA_COTA', code: 'CONTA_EM_PAUSA_COTA', retryable: true, retryAt: 99 }));
    expect(err.success).toBe(true);
    expect(err.data).toMatchObject({ code: 'CONTA_EM_PAUSA_COTA', retryable: true, retryAt: 99, action: 'enqueue' });
    expect(P.BridgeResponseSchema.safeParse(toResponse('x'.repeat(129), 'get', { result: 1 })).success).toBe(false); // id fora do limite
    expect(P.BridgePushSchema.safeParse({ zre: 'flow-health', health: { state: 'healthy' } }).success).toBe(true);
  });

  it('pedidos do app são aceitos pelo relay: 10 ações, id 1..128', () => {
    for (const action of P.BRIDGE_ACTIONS) expect(P.BridgeRequestSchema.safeParse({ zre: 'request', id: 'a', action, payload: {} }).success).toBe(true);
    expect(P.BridgeRequestSchema.safeParse({ zre: 'request', id: 'a', action: 'connect' }).success).toBe(false);
  });

  it('extensionStatus, accounts, enqueue/get (todos os estados) e download: o formato é o do esquema do app', async () => {
    const world = createWorld();
    const tab = world.flowTab();
    await tab.worker.init();
    await tab.worker.tick();

    const status = (await world.rpc('extensionStatus')).result;
    const parsed = P.ExtensionStatusSchema.safeParse(status);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(P.FlowHealthSchema.safeParse(status.health).success).toBe(true);
    for (const a of (await world.rpc('accounts')).result) expect(P.ExtensionAccountSchema.safeParse(a).success).toBe(true);

    const queued = (await world.rpc('enqueue', videoOrder())).result;
    expect(P.OrderViewSchema.parse(queued).state).toBe('queued');
    await tab.worker.tick(); // despacha
    await tab.worker.idle();
    await tab.worker.tick();
    const done = P.OrderViewSchema.parse((await world.rpc('get', { id: queued.id })).result);
    expect(done.state).toBe('completed');
    expect(done.result).toMatchObject({ mimeType: 'video/mp4' });
    expect(done.result.bytes).toBeGreaterThan(0);
    expect(P.DownloadPartSchema.parse((await world.rpc('download', { id: queued.id, part: 0 })).result).done).toBe(true);

    // estados `failed` e `unknown` também respeitam o formato
    const q2 = (await world.rpc('enqueue', videoOrder({ jobId: 'cena:v2:0', key: 'k2', cmd: 'generate.image', args: [{ prompt: 'x', aspectRatio: '9:16' }] }))).result;
    await tab.worker.tick();
    await tab.worker.idle();
    await tab.worker.tick();
    expect(P.OrderViewSchema.parse((await world.rpc('get', { id: q2.id })).result).state).toBe('failed');
  });

  it('o estado da extensão vira o estado da UI (pronta / conta / créditos) sem perder campos', async () => {
    const world = createWorld();
    const tab = world.flowTab();
    await tab.worker.init();
    await tab.worker.tick();
    const raw = P.ExtensionStatusSchema.parse((await world.rpc('extensionStatus')).result);
    const ui = statusFromExtension(raw, { now: world.clock.t });
    expect(ui).toMatchObject({ ready: true, version: '0.1.0' });
    expect(accountUsable(toFlowAccount(raw.accounts[0]), world.clock.t)).toBe(true);
    expect(toFlowAccount(raw.accounts[0])).toMatchObject({ accountId: 'ana@gmail.com', email: 'ana@gmail.com', projectId: FLOW_CTX().projectId, credits: 500 });
  });

  it('o contexto de conta tem a mesma forma {accountId, projectId, accountPath} nos dois lados', () => {
    expect(E.validContext(ctx())).toBe(true);
    expect(P.FlowContextSchema.safeParse(ctx()).success).toBe(true);
    expect(E.validContext({ ...ctx(), accountPath: '/u/3' })).toBe(true);
    expect(E.validContext({ ...ctx(), accountPath: '/x' })).toBe(false);
    expect(ctx().projectId).toBe(PROJECT);
  });
});

describe('o que a bomba do app manda é aceito pelo broker da extensão', () => {
  it('args de generate.video: o formato do tipo GenerateVideoArgs passa na validação do broker; o que o tipo proíbe é recusado', () => {
    const ok = [{ prompt: 'p', aspectRatio: '9:16', durationSeconds: 8, firstFrame: { base64: 'AAAA', mimeType: 'image/png', name: 'a.png' } }];
    expect(E.validateVideoArgs(ok)).toBeNull();
    expect(E.validateVideoArgs([{ prompt: 'p', aspectRatio: '16:9' }])).toBeNull();
    expect(E.validateVideoArgs([{ prompt: 'p', aspectRatio: '1:1' }])).toBe('ASPECTO_NAO_SUPORTADO');
    expect(E.validateVideoArgs([{ prompt: 'p', aspectRatio: '9:16', durationSeconds: 5 }])).toBe('DURACAO_NAO_SUPORTADA');
    expect(E.validateVideoArgs([{ prompt: 'p'.repeat(E.MAX_PROMPT_CHARS + 1), aspectRatio: '9:16' }])).toBe('PROMPT_GRANDE_DEMAIS');
    expect(E.MAX_PROMPT_CHARS).toBeGreaterThan(1200); // o app limita o prompt em 1200 (MAX_PROMPT_CHARS do flow-prompt): sempre cabe
  });
});

describe('manifesto (MV3): permissões mínimas e arquivos que os módulos importam', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

  it('MV3, service worker em módulo, versão, ícones existentes, popup local', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.background).toEqual({ service_worker: 'background/service-worker.js', type: 'module' });
    for (const p of Object.values(manifest.icons)) expect(fs.existsSync(path.join(root, p)), p).toBe(true);
    expect(fs.existsSync(path.join(root, manifest.action.default_popup))).toBe(true);
  });

  it('só as permissões necessárias — nada de downloads/cookies/webRequest/scripting/<all_urls>', () => {
    expect(manifest.permissions.sort()).toEqual(['alarms', 'storage', 'unlimitedStorage']);
    expect(manifest.host_permissions).toEqual(['https://flow.google.com/*', 'https://flow-content.google/*']);
    expect(manifest.externally_connectable).toBeUndefined();
    expect(JSON.stringify(manifest)).not.toMatch(/<all_urls>|\*:\/\/\*\/|https:\/\/\*\//);
  });

  it('content scripts: o relay só em páginas locais; o worker só no flow.google.com', () => {
    const [site, flow] = manifest.content_scripts;
    expect(site.matches).toEqual(['http://127.0.0.1/*', 'http://localhost/*']);
    expect(site.run_at).toBe('document_start');
    expect(flow.matches).toEqual(['https://flow.google.com/*']);
    expect(site.all_frames).toBeUndefined(); // só o quadro principal
  });

  it('todo módulo que um content script importa (transitivamente) é "web accessible" — senão o import dinâmico falha no Chrome', () => {
    const war = manifest.web_accessible_resources[0];
    expect(war.matches).toEqual(['http://127.0.0.1/*', 'http://localhost/*', 'https://flow.google.com/*']);
    expect(war.use_dynamic_url).toBe(true); // a URL dos módulos muda por sessão: uma página não consegue sondar "esta pessoa tem a extensão" pelo id fixo
    const covered = (rel) => war.resources.some((pat) => (pat.endsWith('/*.js') ? rel.startsWith(pat.slice(0, -4)) && rel.endsWith('.js') && !rel.slice(pat.length - 4).includes('/') : pat === rel));
    const seen = new Set();
    const walk = (rel) => {
      if (seen.has(rel)) return;
      seen.add(rel);
      const src = fs.readFileSync(path.join(root, rel), 'utf8');
      for (const m of src.matchAll(/from\s+'(\.[^']+)'/g)) walk(path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1])));
    };
    walk('content/site-relay.js');
    walk('content/flow-main.js');
    expect(seen.size).toBeGreaterThan(8);
    for (const rel of seen) expect(covered(rel), `${rel} precisa estar em web_accessible_resources`).toBe(true);
    // os loaders (clássicos) são os únicos arquivos de content script do manifesto
    expect(manifest.content_scripts.flatMap((c) => c.js).sort()).toEqual(['content/flow-loader.js', 'content/site-relay-loader.js']);
  });
});
