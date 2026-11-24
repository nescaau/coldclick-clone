/**
 * Execução REAL de um vídeo (Flow, pela extensão): estado guardado em `videos.real` (JSON) e regras puras sobre ele.
 *
 * Um vídeo tem N cenas; cada cena é UM clipe de até 8 s gerado no Flow. As cenas rodam em sequência (a seguinte só
 * começa quando a anterior tem o MP4 guardado), cada uma com sua conta escolhida na hora (a troca automática vale
 * entre cenas) e sua própria chave de operação: reenviar a mesma cena devolve a MESMA ordem na extensão.
 */
import crypto from 'node:crypto';

export type RealSceneState = 'fila' | 'gerando' | 'pronto' | 'falhou';

export interface RealScene {
  state: RealSceneState;
  /** Tentativa (0 = primeira). Sobe quando o usuário manda refazer uma cena que falhou. */
  attempt: number;
  /** O prompt enviado (guardado: ao retomar, o pedido tem de ser IDÊNTICO ao original — a chave é a mesma). */
  prompt: string;
  /** Chave estável do pedido na extensão (job + tentativa + prompt). */
  opKey: string;
  /** Id da ordem na extensão (preenchido quando a ponte confirma). */
  orderId: string;
  /** Conta do Flow (e-mail) onde esta cena roda / rodou. */
  accountId: string;
  /** Identidade do clipe no Flow (cartão), quando a extensão informa. */
  mediaRef: string;
  /** MP4 da cena em data/flow/<hash>.mp4. */
  hash: string;
  size: number;
  error: string;
  /** Quem está executando (aba do Zerum) e até quando a reserva vale. */
  pumpId: string;
  leaseUntil: number;
  startedAt: number;
  finishedAt: number;
}

export interface RealRun {
  v: 1;
  scenes: RealScene[];
  /** MP4 final (a própria cena, se só há uma; senão as cenas juntadas). */
  final?: { hash: string; size: number; joined: boolean };
}

/** Quanto tempo uma reserva de cena vale sem sinal da aba que a executa. */
export const LEASE_MS = 90_000;

export const newScene = (): RealScene => ({ state: 'fila', attempt: 0, prompt: '', opKey: '', orderId: '', accountId: '', mediaRef: '', hash: '', size: 0, error: '', pumpId: '', leaseUntil: 0, startedAt: 0, finishedAt: 0 });
export const newRun = (scenes: number): RealRun => ({ v: 1, scenes: Array.from({ length: scenes }, newScene) });

/** Leitura tolerante: JSON ausente/corrompido vira null (o chamador recria). */
export function parseRun(raw: string | null | undefined, scenesTotal: number): RealRun | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<RealRun>;
    if (p?.v !== 1 || !Array.isArray(p.scenes)) return null;
    const scenes = Array.from({ length: scenesTotal }, (_, i) => ({ ...newScene(), ...(p.scenes?.[i] ?? {}) }));
    return { v: 1, scenes, ...(p.final && typeof p.final.hash === 'string' ? { final: p.final } : {}) };
  } catch {
    return null;
  }
}

/** Índice da primeira cena sem MP4 (-1 = todas prontas). */
export const nextScene = (run: RealRun): number => run.scenes.findIndex((s) => s.state !== 'pronto');

/** Quantas cenas prontas em sequência a partir da primeira (é o que a UI mostra como "cena N/M pronta"). */
export const doneCount = (run: RealRun): number => {
  const i = nextScene(run);
  return i === -1 ? run.scenes.length : i;
};

/** Job da cena na extensão: cada cena é um job (o broker fixa um job numa conta — entre cenas a conta pode mudar). */
export const sceneJobId = (videoId: string, idx: number): string => `cena:${videoId}:${idx}`;

/** Chave de operação estável: o mesmo (vídeo, cena, tentativa, prompt) gera SEMPRE a mesma chave. */
export function sceneOpKey(videoId: string, idx: number, attempt: number, prompt: string): string {
  return crypto.createHash('sha256').update(JSON.stringify([videoId, idx, attempt, prompt])).digest('hex');
}

/** A reserva da cena ainda é de `pumpId`? (então esta aba já a está executando — não devolver de novo) */
export const leaseHeldBy = (s: RealScene, pumpId: string, now: number): boolean => s.state === 'gerando' && s.pumpId === pumpId && s.leaseUntil > now;
