/**
 * Produção (aba PRODUÇÃO) — regras puras da máquina de estados de lotes/vídeos/cenas. Sem I/O e sem relógio próprio:
 * o relógio entra como parâmetro, então tudo é testável.
 *
 * Estados do vídeo: fila → gerando → pronto | falhou | cancelado. O lote agrega: na_fila / rodando / parado / pronto /
 * falhou / cancelado. As CENAS não têm linha própria: o estado de cada uma deriva de `scenesDone` e `failScene`.
 *
 * Quem GERA de verdade é o executor (fase futura, extensão). Aqui existe só o executor SIMULADO, que avança o relógio
 * (uma cena a cada `sceneMs`) para o fluxo inteiro poder ser exercitado localmente — e é sempre rotulado como simulação.
 */

export type VideoState = 'fila' | 'gerando' | 'pronto' | 'falhou' | 'cancelado';
export type BatchRunState = 'na_fila' | 'rodando' | 'parado' | 'pronto' | 'falhou' | 'cancelado';
export type SceneState = 'fila' | 'gerando' | 'pronto' | 'falhou';

export interface SimConfig {
  /** Duração simulada de cada cena. */
  sceneMs: number;
  /** "Vídeos simultâneos" (⚙ → Geração). */
  parallel: number;
  /** Teste do estado "falhou": todo N-ésimo vídeo falha na 1ª tentativa (0 = nunca). */
  failEvery: number;
}

export interface VideoRun {
  id: string;
  idx: number;
  state: VideoState;
  scenesTotal: number;
  scenesDone: number;
  failScene: number | null;
  attempt: number;
  /** ms desde a época (null se nunca começou). */
  startedAt: number | null;
}

export interface VideoPatch {
  state?: VideoState;
  scenesDone?: number;
  failScene?: number | null;
  error?: string;
  startedAt?: number | null;
  finishedAt?: number | null;
  /** Quantas vezes o vídeo começou (a 1ª tentativa é 1). */
  attempt?: number;
}
export interface Change {
  id: string;
  idx: number;
  patch: VideoPatch;
  /** Linha de log (escrita no log do lote). */
  log?: { level: 'info' | 'aviso' | 'erro'; message: string };
}

/** Cada clipe do Flow tem até 8 s: cenas = duração do viral / 8 (1..8). Sem duração conhecida (ideia), 4. */
export const SCENE_SECONDS = 8;
export const sceneCount = (durationS: number | null): number => (durationS && durationS > 0 ? Math.max(1, Math.min(8, Math.ceil(durationS / SCENE_SECONDS))) : 4);

/** "O Google não conseguiu terminar esta cena (cena N) em 3 tentativas…" — texto literal do original. */
export const sceneFailureMessage = (scene1: number): string =>
  `O Google não conseguiu terminar esta cena (cena ${scene1}) em 3 tentativas (falha do lado dele; nada se perdeu). Clique em Tentar de novo nesta cena — as outras cenas ficam prontas.`;

/** Falha real: o arquivo do viral que alimenta a simulação não existe mais. */
export const MISSING_SOURCE_MESSAGE = 'Não consegui abrir o vídeo de origem: o arquivo do viral não está mais neste computador. Envie o viral de novo e gere outra vez.';

export const sceneStateOf = (v: Pick<VideoRun, 'state' | 'scenesDone' | 'failScene'>, i: number): SceneState => {
  if (v.state === 'falhou' && v.failScene === i) return 'falhou';
  if (i < v.scenesDone) return 'pronto';
  if (v.state === 'gerando' && i === v.scenesDone) return 'gerando';
  return 'fila';
};

/** Quando falha (se for falhar) a cena escolhida: a 2ª, ou a última se o vídeo tem só 1. */
const failSceneIndex = (total: number) => Math.min(1, total - 1);
const shouldInjectFailure = (idx: number, attempt: number, cfg: SimConfig) => cfg.failEvery > 0 && attempt <= 1 && (idx + 1) % cfg.failEvery === 0;

export interface AdvanceOpts {
  stopRequested: boolean;
  /** O arquivo de origem some → todos os vídeos que começarem falham (falha real, não injetada). */
  sourceMissing: boolean;
}

/**
 * Avança o relógio: conclui/falha os vídeos em andamento e inicia os da fila até `parallel` simultâneos.
 * Idempotente: chamar duas vezes com o mesmo `now` não produz mudanças novas.
 */
export function advanceVideos(videos: readonly VideoRun[], now: number, cfg: SimConfig, opts: AdvanceOpts): Change[] {
  const changes: Change[] = [];
  const sorted = [...videos].sort((a, b) => a.idx - b.idx);
  const sceneMs = Math.max(1, cfg.sceneMs);
  let running = 0;

  for (const v of sorted) {
    if (v.state !== 'gerando') continue;
    const started = v.startedAt ?? now;
    const elapsedScenes = Math.max(0, Math.floor((now - started) / sceneMs));
    const done = Math.min(v.scenesTotal, elapsedScenes);

    if (shouldInjectFailure(v.idx, v.attempt, cfg) && done > failSceneIndex(v.scenesTotal)) {
      const fs = failSceneIndex(v.scenesTotal);
      changes.push({
        id: v.id,
        idx: v.idx,
        patch: { state: 'falhou', scenesDone: fs, failScene: fs, error: sceneFailureMessage(fs + 1), finishedAt: now },
        log: { level: 'erro', message: `Vídeo ${v.idx + 1}: FALHOU — cena ${fs + 1} (teste de falha simulada ligado no ⚙). As cenas prontas ficam; clique em "Tentar de novo".` },
      });
      continue;
    }
    if (done >= v.scenesTotal) {
      changes.push({
        id: v.id,
        idx: v.idx,
        patch: { state: 'pronto', scenesDone: v.scenesTotal, failScene: null, error: '', finishedAt: now },
        log: { level: 'info', message: `Vídeo ${v.idx + 1}: PRONTO (${v.scenesTotal} cena${v.scenesTotal === 1 ? '' : 's'}) — simulação local.` },
      });
      continue;
    }
    running++;
    if (done !== v.scenesDone) {
      changes.push({
        id: v.id,
        idx: v.idx,
        patch: { scenesDone: done },
        log: { level: 'info', message: `Vídeo ${v.idx + 1}: cena ${done}/${v.scenesTotal} pronta; gerando a cena ${done + 1}…` },
      });
    }
  }

  if (!opts.stopRequested) {
    let slots = Math.max(1, cfg.parallel) - running;
    for (const v of sorted) {
      if (slots <= 0) break;
      if (v.state !== 'fila') continue;
      if (opts.sourceMissing) {
        changes.push({
          id: v.id,
          idx: v.idx,
          patch: { state: 'falhou', failScene: 0, error: MISSING_SOURCE_MESSAGE, finishedAt: now },
          log: { level: 'erro', message: `Vídeo ${v.idx + 1}: FALHOU — ${MISSING_SOURCE_MESSAGE}` },
        });
        continue;
      }
      slots--;
      // "As cenas prontas ficam": ao retomar, o relógio é recuado para preservar as cenas que já estavam prontas.
      changes.push({
        id: v.id,
        idx: v.idx,
        patch: { state: 'gerando', attempt: v.attempt + 1, startedAt: now - v.scenesDone * sceneMs, failScene: null, error: '', finishedAt: null },
        log: { level: 'info', message: `Vídeo ${v.idx + 1}: começou a gerar (${v.scenesTotal} cena${v.scenesTotal === 1 ? '' : 's'}${v.scenesDone ? `, retomando da cena ${v.scenesDone + 1}` : ''}).` },
      });
    }
  }
  return changes;
}

/** Aplica as mudanças sobre a foto atual (útil para decidir o estado do lote sem reler o banco). */
export function applyChanges(videos: readonly VideoRun[], changes: readonly Change[]): VideoRun[] {
  const byId = new Map(changes.map((c) => [c.id, c.patch]));
  return videos.map((v) => {
    const p = byId.get(v.id);
    if (!p) return v;
    return {
      ...v,
      state: p.state ?? v.state,
      scenesDone: p.scenesDone ?? v.scenesDone,
      failScene: p.failScene === undefined ? v.failScene : p.failScene,
      startedAt: p.startedAt === undefined ? v.startedAt : p.startedAt,
      attempt: p.attempt ?? v.attempt,
    };
  });
}

/** Estado agregado do lote a partir dos vídeos. */
export function batchStateOf(states: readonly VideoState[], stopRequested: boolean): BatchRunState {
  if (states.length === 0) return 'na_fila';
  const has = (s: VideoState) => states.includes(s);
  if (has('gerando')) return 'rodando';
  if (has('fila')) return stopRequested ? 'parado' : 'na_fila';
  if (states.every((s) => s === 'cancelado')) return 'cancelado';
  if (has('falhou')) return 'falhou';
  if (states.every((s) => s === 'pronto' || s === 'cancelado')) return 'pronto';
  return 'cancelado';
}

/**
 * "Nome_12345.mp4": código de 5 dígitos, DIFERENTE em cada vídeo do lote (o passo 7919 é coprimo de 100000: nenhuma
 * colisão dentro do lote) e estável entre downloads. `batchHash` = hash hex do id do lote; `idx` = posição do vídeo.
 */
export function downloadName(batchName: string, batchHash: string, idx: number): string {
  const base = parseInt(batchHash.slice(0, 8), 16) % 100000;
  const code = String((base + idx * 7919) % 100000).padStart(5, '0');
  return `${batchName || 'Zerum'}_${code}.mp4`;
}

/** Rótulo curto do estado (maiúsculo no card): PRONTO / FALHOU / gerando… como no original. */
export const VIDEO_STATE_LABEL: Record<VideoState, string> = {
  fila: 'na fila',
  gerando: 'gerando',
  pronto: 'PRONTO',
  falhou: 'FALHOU',
  cancelado: 'cancelado',
};
