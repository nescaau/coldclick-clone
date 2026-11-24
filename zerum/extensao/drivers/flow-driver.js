/**
 * Driver do Flow: a SEQUÊNCIA de passos para gerar um clipe e acompanhar o resultado — independente de como a página
 * é "tocada". Quem toca a página é o `page` (drivers/dom-page.js no navegador; drivers/mock-page.js nos testes).
 *
 * Regra de ouro (herdada do original): o que NÃO pode ser repetido é o clique em "gerar".
 *  - qualquer falha ANTES do clique → `state: 'failed'` (nada foi enviado ao Flow; seguro refazer);
 *  - qualquer incerteza DEPOIS do clique → `state: 'unknown'` (pode ter gerado e cobrado; só se reconcilia lendo);
 *  - `watch()` nunca clica em nada que gere: só lê a grade de clipes.
 */
import { ERROR_CODES, errorCodeFromFlowText } from '../lib/protocol.js';
import { ZerumError, sleep as realSleep } from '../lib/util.js';

/** Erro do driver. `state` diz ao worker o que dizer ao broker (`failed` = nada enviado; `unknown` = incerto). */
export class DriverError extends ZerumError {
  constructor(code, state = 'failed', details = {}) {
    super(code, { state, ...details });
    this.name = 'DriverError';
  }
}

/** O `page` lança isto quando um elemento esperado não existe — o código aponta QUAL seletor consertar. */
export class SelectorMissing extends ZerumError {
  constructor(name) {
    super(`SELETOR_AUSENTE:${name}`, { selector: name });
    this.name = 'SelectorMissing';
  }
}

export const DEFAULTS = {
  /** Depois do clique, quanto esperar até o cartão novo aparecer na grade. */
  confirmMs: 60_000,
  /** Intervalo entre leituras da grade. */
  pollMs: 3_000,
  /** Quanto esperar o clipe ficar pronto antes de devolver "ainda pendente" (continua reconciliável). */
  watchMs: 12 * 60_000,
  /** Sem achar o cartão por este tempo → não dá para ler (incerto, reconciliável). */
  missingMs: 90_000,
};

export function createFlowDriver({ page, sleep = realSleep, now = Date.now, config = {} }) {
  const cfg = { ...DEFAULTS, ...config };

  /** Converte erro do `page` em DriverError respeitando a regra do clique. */
  const wrap = (e, state) => {
    if (e instanceof DriverError) return e;
    if (e instanceof SelectorMissing) return new DriverError(e.code, state, { selector: e.selector });
    return new DriverError(e?.code || 'DRIVER_ERRO', state, { detalhe: String(e?.message || e).slice(0, 160) });
  };

  const driver = {
    /** Quem está logado e em que projeto (a mesma identidade que o broker usa como contexto). */
    async identify() {
      const id = await page.identity();
      const ready = !!(id.email && id.projectId && id.loggedIn !== false);
      return { ...id, ready, reason: ready ? '' : !id.email ? 'SEM_CONTA_LOGADA' : 'ABRA_UM_PROJETO_NO_FLOW' };
    },

    async credits() {
      try {
        const n = await page.readCredits();
        return Number.isInteger(n) && n >= 0 ? n : null;
      } catch {
        return null;
      }
    },

    /** Relatório elemento-por-elemento (o que o popup mostra em "Diagnóstico do Flow"). */
    async probe() {
      return { identity: await driver.identify(), elements: await page.probe() };
    },

    /**
     * Preenche e envia UM pedido de vídeo. Devolve a identidade do cartão que apareceu (`tileId`), que é o que
     * permite reler o resultado depois — inclusive após recarregar a aba — sem NUNCA clicar em gerar de novo.
     * @param spec {prompt, aspectRatio, model?, firstFrame?: {base64,mimeType,name}}
     * @param opts {exclude?: Iterable<string>}  ids de cartões que pertencem a OUTRAS ordens (não podem ser confundidos)
     */
    async submitVideo(spec, { exclude = [] } = {}) {
      let clicked = false;
      try {
        const known = new Set([...exclude, ...(await page.snapshotTiles()).map((t) => t.id)]);
        await page.prepareComposer({ aspectRatio: spec.aspectRatio, model: spec.model || '', hasFrame: !!spec.firstFrame });
        if (spec.firstFrame) await page.attachFirstFrame(spec.firstFrame);
        await page.typePrompt(spec.prompt);
        const typed = String(await page.readPrompt()).replace(/\s+/g, ' ').trim();
        if (typed !== spec.prompt.replace(/\s+/g, ' ').trim()) throw new DriverError('PROMPT_NAO_ESCRITO', 'failed');

        await page.clickGenerate();
        clicked = true; // daqui em diante qualquer dúvida é "incerto": o Flow pode ter aceitado o pedido

        const t0 = now();
        for (;;) {
          const fresh = (await page.snapshotTiles()).filter((t) => !known.has(t.id));
          if (fresh.length) {
            // Prefere o cartão que traz o início do prompt (quando a página mostra o texto); senão o primeiro novo.
            const hint = spec.prompt.slice(0, 24).toLowerCase();
            const pick = fresh.find((t) => t.text && t.text.toLowerCase().includes(hint)) ?? fresh[0];
            return { tileId: pick.id, weak: !!pick.weak, submittedAt: now() };
          }
          const err = await page.readErrors();
          if (err) {
            // O Flow recusou NA HORA: nada foi gerado (nem cobrado).
            throw new DriverError(errorCodeFromFlowText(err), 'failed', { errorText: err.slice(0, 200) });
          }
          if (now() - t0 >= cfg.confirmMs) throw new DriverError('ENVIO_NAO_CONFIRMADO', 'unknown');
          await sleep(cfg.pollMs);
        }
      } catch (e) {
        throw wrap(e, clicked ? 'unknown' : 'failed');
      }
    },

    /**
     * Acompanha um cartão até ficar pronto (devolve onde ler o vídeo) ou falhar. Só LÊ.
     * @param resume {tileId}
     * @param opts {onProgress?, signal?, timeoutMs?}
     */
    async watch(resume, { onProgress = () => {}, signal, timeoutMs = cfg.watchMs } = {}) {
      if (!resume?.tileId) throw new DriverError('SEM_ID_PARA_RECONCILIAR', 'unknown');
      const t0 = now();
      let missingSince = 0;
      for (;;) {
        if (signal?.aborted) throw new DriverError('CANCELADO', 'unknown');
        let tile;
        try {
          tile = await page.readTile(resume.tileId);
        } catch (e) {
          throw wrap(e, 'unknown');
        }
        if (!tile) {
          missingSince ||= now();
          if (now() - missingSince >= cfg.missingMs) throw new DriverError('CARTAO_NAO_ENCONTRADO', 'unknown', { tileId: resume.tileId });
        } else {
          missingSince = 0;
          if (tile.state === 'failed') {
            const text = tile.error || '';
            throw new DriverError(errorCodeFromFlowText(text) === ERROR_CODES.generic ? 'FLOW_FALHOU' : errorCodeFromFlowText(text), 'failed', { errorText: text.slice(0, 200) });
          }
          if (tile.state === 'ready' && tile.mediaUrl) return { tileId: resume.tileId, media: { url: tile.mediaUrl, mimeType: tile.mimeType || 'video/mp4' }, tile };
          await onProgress({ phase: tile.state === 'ready' ? 'finalizando' : 'gerando', progress: tile.progress ?? null });
        }
        if (now() - t0 >= timeoutMs) throw new DriverError('GERACAO_AINDA_PENDENTE', 'unknown', { tileId: resume.tileId });
        await sleep(cfg.pollMs);
      }
    },
  };
  return driver;
}
