/**
 * "Flow de mentira" para testes e demonstração: implementa a MESMA interface de página que drivers/dom-page.js
 * (identity, readCredits, probe, prepareComposer, attachFirstFrame, typePrompt, readPrompt, clickGenerate,
 * snapshotTiles, readTile, readErrors, mediaBytes), mas sobre um estado em memória. Nenhuma rede, nenhum navegador.
 *
 * O resultado de cada geração é roteirizado: `outcomes` é uma fila — cada clique em "gerar" consome o próximo item:
 *   { kind: 'ready', reads: 2 }              pronto depois de 2 leituras do cartão (padrão)
 *   { kind: 'failed', error: 'quota ...' }   o cartão mostra uma falha
 *   { kind: 'refuse', error: '...' }         recusa NA HORA (toast que fica na tela), sem criar cartão
 *   { kind: 'refuse', error, transient: true } o aviso aparece numa leitura e some (não prova recusa)
 *   { kind: 'silent' }                       clicou e nada aparece (envio não confirmado)
 *   { kind: 'hang' }                         cartão fica "gerando" para sempre
 */
import { SelectorMissing } from '../drivers/flow-driver.js';

export const MOCK_PROJECT = '33333333-3333-4333-8333-333333333333';
/** MP4 mínimo (cabeçalho ftyp + bytes) — só para ter conteúdo reconhecível. */
export const MOCK_MP4 = Uint8Array.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 2, 0, 105, 115, 111, 109, 109, 112, 52, 49, 1, 2, 3, 4, 5, 6, 7, 8]);

export function createMockPage({ email = 'ana@gmail.com', projectId = MOCK_PROJECT, accountPath = '', credits = 500, loggedIn = true, outcomes = [], missing = [], mediaKind = 'url' } = {}) {
  const state = { email, projectId, accountPath, credits, loggedIn, tiles: [], prompt: '', frame: null, errors: [], sticky: '', seq: 0, outcomes: [...outcomes], missing: new Set(missing) };
  const calls = [];
  const need = (name) => {
    if (state.missing.has(name)) throw new SelectorMissing(name);
  };
  const find = (id) => state.tiles.find((t) => t.id === id);

  const page = {
    state,
    calls,
    /** Roteiriza o próximo resultado. */
    queueOutcome: (o) => state.outcomes.push(o),

    async identity() {
      calls.push('identity');
      return { email: state.loggedIn ? state.email : '', projectId: state.projectId, accountPath: state.accountPath, loggedIn: state.loggedIn };
    },
    async readCredits() {
      calls.push('readCredits');
      return state.credits;
    },
    async probe() {
      return Object.fromEntries(['accountButton', 'promptBox', 'generateButton', 'aspectPortrait', 'outputsOne', 'tile'].map((n) => [n, { found: !state.missing.has(n), count: state.missing.has(n) ? 0 : 1, status: 'mock' }]));
    },
    async prepareComposer({ aspectRatio, model, hasFrame }) {
      calls.push(`prepare:${aspectRatio}:${model || '-'}:${hasFrame ? 'frame' : 'text'}`);
      need('generateButton');
      need('promptBox');
      if (aspectRatio === '9:16') need('aspectPortrait');
      need('outputsOne');
      state.errors = [];
      state.sticky = '';
    },
    async attachFirstFrame(file) {
      calls.push('attachFirstFrame');
      need('fileInput');
      state.frame = { mimeType: file.mimeType, bytes: file.base64.length };
    },
    async typePrompt(text) {
      calls.push('typePrompt');
      need('promptBox');
      state.prompt = text;
    },
    async readPrompt() {
      return state.prompt;
    },
    async clickGenerate() {
      calls.push('clickGenerate');
      need('generateButton');
      const o = state.outcomes.shift() ?? { kind: 'ready', reads: 2 };
      if (o.kind === 'refuse') {
        // `transient`: o aviso aparece numa leitura só e some (palpite fraco). Padrão: fica na tela (recusa de verdade).
        if (o.transient) state.errors.push(o.error);
        else state.sticky = o.error;
        return;
      }
      if (o.kind === 'silent') return;
      const id = o.id ?? `tile-${++state.seq}`;
      state.tiles.push({ id, text: state.prompt, outcome: o, reads: 0, prompt: state.prompt });
    },
    async snapshotTiles() {
      return state.tiles.map((t) => ({ id: t.id, text: t.text, state: 'pending' }));
    },
    async readTile(id) {
      calls.push(`readTile:${id}`);
      const t = find(id);
      if (!t) return null;
      t.reads++;
      const o = t.outcome;
      if (o.kind === 'failed') return { id, state: 'failed', error: o.error };
      if (o.kind === 'hang' || t.reads <= (o.reads ?? 2)) return { id, state: 'pending', progress: Math.min(95, t.reads * 30) };
      return { id, state: 'ready', mediaUrl: mediaKind === 'blob' ? `blob:mock/${id}` : `https://flow-content.google/video/${id}`, mimeType: 'video/mp4' };
    },
    async readErrors() {
      return state.sticky || (state.errors.shift() ?? '');
    },
    /** Só para `blob:` (a aba lê os bytes); URLs https o service worker busca. */
    async mediaBytes(url) {
      calls.push(`mediaBytes:${url}`);
      return url.startsWith('blob:') ? { bytes: MOCK_MP4, mimeType: 'video/mp4' } : null;
    },
  };
  return page;
}
