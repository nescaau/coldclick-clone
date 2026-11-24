import { describe, expect, it } from 'vitest';
import {
  MISSING_SOURCE_MESSAGE,
  advanceVideos,
  applyChanges,
  batchStateOf,
  downloadName,
  sceneCount,
  sceneStateOf,
  type SimConfig,
  type VideoRun,
} from './production';

const cfg: SimConfig = { sceneMs: 1000, parallel: 2, failEvery: 0 };
const opts = { stopRequested: false, sourceMissing: false };
const video = (idx: number, o: Partial<VideoRun> = {}): VideoRun => ({ id: `v${idx}`, idx, state: 'fila', scenesTotal: 3, scenesDone: 0, failScene: null, attempt: 0, startedAt: null, ...o });

/** Roda a máquina até `now` aplicando as mudanças (como o serviço faz a cada leitura). */
function run(videos: VideoRun[], now: number, c: SimConfig = cfg, o = opts): VideoRun[] {
  return applyChanges(videos, advanceVideos(videos, now, c, o));
}

describe('sceneCount', () => {
  it('cenas = duração / 8 s (1..8); sem duração (ideia) são 4', () => {
    expect(sceneCount(32)).toBe(4);
    expect(sceneCount(8)).toBe(1);
    expect(sceneCount(9)).toBe(2);
    expect(sceneCount(500)).toBe(8);
    expect(sceneCount(null)).toBe(4);
  });
});

describe('advanceVideos (executor simulado, relógio injetado)', () => {
  it('respeita "vídeos simultâneos": só `parallel` começam; o resto fica na fila', () => {
    const v = run([video(0), video(1), video(2)], 0);
    expect(v.map((x) => x.state)).toEqual(['gerando', 'gerando', 'fila']);
    expect(v[0].attempt).toBe(1); // a 1ª tentativa é 1
  });

  it('uma cena a cada sceneMs; ao terminar todas o vídeo fica pronto e libera vaga para o próximo', () => {
    let v = run([video(0), video(1), video(2)], 0);
    v = run(v, 1000);
    expect(v[0]).toMatchObject({ state: 'gerando', scenesDone: 1 });
    v = run(v, 3000);
    expect(v.map((x) => x.state)).toEqual(['pronto', 'pronto', 'gerando']); // vagas liberadas → o 3º começa
    expect(v[0].scenesDone).toBe(3);
  });

  it('é idempotente: repetir o mesmo `now` não gera mudanças', () => {
    const v = run([video(0)], 0);
    expect(advanceVideos(v, 0, cfg, opts)).toEqual([]);
  });

  it('"Parar depois dos atuais": os em andamento terminam, nenhum novo começa', () => {
    let v = run([video(0), video(1), video(2)], 0);
    v = run(v, 5000, cfg, { ...opts, stopRequested: true });
    expect(v.map((x) => x.state)).toEqual(['pronto', 'pronto', 'fila']);
    expect(batchStateOf(v.map((x) => x.state), true)).toBe('parado');
  });

  it('falha simulada: todo N-ésimo vídeo falha na 1ª tentativa (na 2ª cena); a retentativa não falha de novo', () => {
    const c = { ...cfg, failEvery: 2 };
    let v = run([video(0), video(1)], 0, c);
    v = run(v, 5000, c);
    expect(v[0].state).toBe('pronto');
    expect(v[1]).toMatchObject({ state: 'falhou', failScene: 1, scenesDone: 1 });
    expect(sceneStateOf(v[1], 0)).toBe('pronto');
    expect(sceneStateOf(v[1], 1)).toBe('falhou');
    expect(sceneStateOf(v[1], 2)).toBe('fila');

    // "↻ Tentar de novo": volta à fila MANTENDO as cenas prontas e, na 2ª tentativa, termina.
    const retry = v.map((x) => (x.state === 'falhou' ? { ...x, state: 'fila' as const, failScene: null } : x));
    const started = advanceVideos(retry, 6000, c, opts);
    const s = started.find((x) => x.id === 'v1')!;
    expect(s.patch).toMatchObject({ state: 'gerando', attempt: 2, startedAt: 5000 }); // 6000 - 1 cena pronta × 1000
    let r = applyChanges(retry, started);
    r = run(r, 8000, c);
    expect(r[1].state).toBe('pronto');
  });

  it('arquivo de origem sumiu → o vídeo FALHA com a mensagem real, sem simular sucesso', () => {
    const v = run([video(0)], 0, cfg, { ...opts, sourceMissing: true });
    expect(v[0].state).toBe('falhou');
    const ch = advanceVideos([video(0)], 0, cfg, { ...opts, sourceMissing: true });
    expect(ch[0].patch.error).toBe(MISSING_SOURCE_MESSAGE);
  });

  it('as mudanças trazem uma linha de log por transição', () => {
    const ch = advanceVideos([video(0)], 0, cfg, opts);
    expect(ch[0].log?.message).toMatch(/começou a gerar/);
  });
});

describe('batchStateOf', () => {
  it.each([
    [['gerando', 'fila'], false, 'rodando'],
    [['fila', 'fila'], false, 'na_fila'],
    [['pronto', 'fila'], true, 'parado'],
    [['pronto', 'pronto'], false, 'pronto'],
    [['pronto', 'falhou'], false, 'falhou'],
    [['cancelado', 'cancelado'], false, 'cancelado'],
    [['pronto', 'cancelado'], false, 'pronto'],
    [[], false, 'na_fila'],
  ] as const)('%j (parar=%s) → %s', (states, stop, esperado) => expect(batchStateOf(states, stop)).toBe(esperado));
});

describe('downloadName', () => {
  it('Nome_12345.mp4 — código de 5 dígitos estável; NUNCA se repete dentro do lote', () => {
    const a = downloadName('Umbigo', 'abcdef0123456789', 0);
    expect(a).toMatch(/^Umbigo_\d{5}\.mp4$/);
    expect(downloadName('Umbigo', 'abcdef0123456789', 0)).toBe(a);
    const nomes = Array.from({ length: 50 }, (_, i) => downloadName('Umbigo', 'abcdef0123456789', i));
    expect(new Set(nomes).size).toBe(50);
    expect(downloadName('Umbigo', '12345678aaaa', 0)).not.toBe(a);
    expect(downloadName('', 'abcdef0123456789', 3)).toMatch(/^Zerum_\d{5}\.mp4$/);
  });
});
