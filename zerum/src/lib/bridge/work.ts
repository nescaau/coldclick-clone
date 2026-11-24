/**
 * Tipos trocados entre a página (que executa pela ponte) e o servidor (que decide o que executar e guarda o resultado).
 * Só tipos: nada de lógica nem de I/O.
 */
import type { BridgeStatus } from './status';
import type { VideoDTO } from '../types';

export type ExecutionMode = 'simulado' | 'real' | 'espera';

/** Uma cena (um clipe de até 8 s) para a página mandar à extensão. */
export interface SceneWork {
  videoId: string;
  batchId: string;
  sceneIdx: number;
  sceneCount: number;
  /** Job da cena na extensão (cada cena é um job; entre cenas a conta pode mudar). */
  jobId: string;
  /** Chave estável do pedido: a mesma cena com a mesma chave devolve a MESMA ordem (nunca uma geração nova). */
  opKey: string;
  /** Tentativa (0 = primeira). Maior que a da extensão ⇒ a página abre a próxima com `beginAttempt`. */
  attempt: number;
  /** Conta do Flow (e-mail) onde a cena roda. */
  accountId: string;
  /** Já existe ordem dessa cena na extensão (a página só relê/retoma — o `enqueue` com a mesma chave devolve a mesma). */
  resume: boolean;
  args: { prompt: string; aspectRatio: '9:16'; durationSeconds: 8 };
  /** Foto do avatar (imagem de partida), buscada pela página em /api/avatars/<id>/photo. */
  reference: { avatarId: string; mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; name: string } | null;
  /** "Vídeo 2 · cena 3/4" — para as mensagens da página. */
  label: string;
}

export interface ClaimResponse {
  work: SceneWork | null;
  /** Por que não há trabalho (vazio quando há). */
  reason: string;
  mode: ExecutionMode;
}

export interface HeartbeatResponse {
  /** Esta aba é a que pode executar (só uma por vez). */
  leader: boolean;
  mode: ExecutionMode;
  status: BridgeStatus;
}

export interface ProgressResponse {
  /** false = pare: o vídeo foi cancelado/removido ou outra aba assumiu a cena. */
  continue: boolean;
  reason: string;
}

export interface ClipResponse {
  video: VideoDTO;
  /** O vídeo inteiro ficou pronto (todas as cenas baixadas e, se preciso, juntadas). */
  finished: boolean;
}

export interface FailResponse {
  video: VideoDTO;
  /** A cena voltou para a fila (troca automática: outra conta vai refazê-la) em vez de falhar o vídeo. */
  requeued: boolean;
}
