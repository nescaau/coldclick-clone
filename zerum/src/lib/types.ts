/** Tipos trafegados entre API e interface (DTOs). Datas = ISO-8601 UTC. */
import type { DirectorMode } from './domain/director';
import type { VideoOptions, LanguageId } from './domain/video-options';
import type { ViralAnalysis } from './domain/analysis';
import type { PlanParams, PlanStep } from './domain/plan';
import type { Gender } from './domain/avatar';
import type { BatchRunState, SceneState, VideoState } from './domain/production';
import { DEFAULT_BRAIN, DEFAULT_IMAGE_MODEL, DEFAULT_PARALLEL, DEFAULT_SUBTITLE, type SubtitleSettings } from './domain/settings';

export type { DirectorMode, VideoOptions, LanguageId, ViralAnalysis, PlanParams, PlanStep, Gender, VideoState, SceneState, SubtitleSettings };

export interface ViralDTO {
  id: string;
  name: string;
  sizeBytes: number;
  /** 'analisado' = metadados lidos (a leitura por IA é fase futura); 'preparando' = só guardado. */
  state: 'preparando' | 'analisado';
  durationS: number | null;
  width: number | null;
  height: number | null;
  hasAudio: boolean | null;
  analysis: ViralAnalysis | null;
  /** O usuário corrigiu a análise (existe "voltar à original"). */
  corrected: boolean;
  /** Primeira frase da transcrição ("Gancho:"). */
  gancho: string;
  createdAt: string;
}

export type MessageRole = 'aluna' | 'diretor' | 'sistema';

export interface PlanDTO {
  id: string;
  /** O plano só executa depois que o usuário confirma (requer_confirmacao). */
  requerConfirmacao: true;
  state: 'pendente' | 'executado' | 'cancelado' | 'substituido';
  steps: PlanStep[];
  params: PlanParams;
  batchId: string | null;
}

export interface MessageDTO {
  id: string;
  role: MessageRole;
  text: string;
  attachments: { nome: string }[];
  plan: PlanDTO | null;
  createdAt: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  mode: DirectorMode;
  hasViral: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationDetail extends ConversationSummary {
  options: VideoOptions;
  viral: ViralDTO | null;
  messages: MessageDTO[];
}

export type BatchState = BatchRunState | 'preparando';

export interface VideoDTO {
  id: string;
  batchId: string;
  idx: number;
  title: string;
  /** Roteiro por cena. */
  scenes: { fala: string; state: SceneState }[];
  avatarName: string;
  state: VideoState;
  scenesTotal: number;
  scenesDone: number;
  failScene: number | null;
  error: string;
  attempt: number;
  /** Nome do arquivo ao baixar ("Nome_12345.mp4"). */
  downloadName: string;
  /** true = o arquivo entregue é a CÓPIA simulada (selo SIMULADO); false = o MP4 foi gerado e baixado do Flow pela extensão (ver README). */
  simulated: boolean;
  finishedAt: string | null;
  createdAt: string;
}

export interface BatchDTO {
  id: string;
  conversationId: string | null;
  viralId: string | null;
  viralName: string | null;
  source: 'diretor' | 'manual';
  title: string;
  quantity: number;
  word: string;
  batchName: string;
  bubbleOn: boolean;
  bubbleColor: string;
  language: LanguageId;
  requestText: string;
  state: BatchState;
  path: PlanParams['path'];
  variation: PlanParams['variation'];
  avatars: string[];
  notes: string;
  stopRequested: boolean;
  archived: boolean;
  videos: VideoDTO[];
  createdAt: string;
  updatedAt: string;
}

export interface EventDTO {
  id: number;
  level: 'info' | 'aviso' | 'erro';
  message: string;
  createdAt: string;
}

export interface AvatarDTO {
  id: string;
  name: string;
  description: string;
  gender: Gender;
  hasPhoto: boolean;
  origin: 'foto' | 'gerado' | 'manual' | 'diretor';
  createdAt: string;
}

export interface SettingsDTO {
  /** "Troca automática de conta" (painel Contas Flow): na geração real, cada cena escolhe a conta com crédito (ver bridge/accounts.ts). */
  autoSwitch: boolean;
  /** "Trocar abaixo de créditos" (padrão 20, como no original). */
  minCredits: number;
  /** "Vídeos simultâneos". */
  parallel: number;
  /** "Imagem" (modelo de imagem). */
  imageModel: string;
  /** "INTELIGÊNCIA": preferência de "cérebro" (sem efeito: o Diretor local não chama IA). */
  brain: string;
  /** "Guardar também uma cópia no projeto do Flow (vídeos até 30 s)". */
  flowCopy: boolean;
  subtitle: SubtitleSettings;
  /** "Aprovar tudo automaticamente": o plano do Diretor executa sem clique. */
  autoApprove: boolean;
  /** Simulação local da geração (padrão: ligada). Desligada + extensão do Flow pronta = geração REAL; desligada sem extensão = lote na fila. */
  simulation: boolean;
  /** Teste do estado "falhou": todo N-ésimo vídeo falha na 1ª tentativa (0 = desligado). */
  simFailEvery: number;
  /** "••••1234" da chave guardada (a chave inteira nunca sai do servidor); null se não há. */
  apiKeyMasked: string | null;
  /** "Nunca repete uma combinação sua (N de 80 usadas)". */
  roletaUsed: number;
}

export const DEFAULT_SETTINGS: SettingsDTO = {
  autoSwitch: false,
  minCredits: 20,
  parallel: DEFAULT_PARALLEL,
  imageModel: DEFAULT_IMAGE_MODEL,
  brain: DEFAULT_BRAIN,
  flowCopy: true,
  subtitle: DEFAULT_SUBTITLE,
  autoApprove: false,
  simulation: true,
  simFailEvery: 0,
  apiKeyMasked: null,
  roletaUsed: 0,
};

export interface SendMessageResult {
  conversation: ConversationDetail;
  batch: BatchDTO | null;
  plan: PlanDTO | null;
}
