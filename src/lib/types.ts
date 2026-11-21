/** DTOs compartilhados entre servidor (serviços/API) e cliente (componentes). */
import type { FormatId, ModelId, ResolutionId } from './catalog';

export type JobStatus = 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';
export type ItemStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
export type ItemKind = 'image' | 'video';
export type TranscriptSource = 'whisper' | 'manual' | 'none';
/** Fase em que o trabalho está (ou parou): imagens-base → vídeos → concluído. */
export type JobPhase = 'images' | 'videos' | 'done';

export interface VideoDTO {
  id: string;
  name: string;
  url: string;
  mime: string;
  sizeBytes: number;
  durationSec: number | null;
  source: 'upload' | 'url';
  sourceUrl: string | null;
  transcript: string | null;
  transcriptLanguage: string | null;
  createdAt: string;
}

export interface AvatarPhotoDTO {
  id: string;
  url: string;
  originalName: string;
}

export interface AvatarDTO {
  id: string;
  name: string;
  /** Descrição do personagem em inglês (idade, aparência, roupa, cenário). */
  description: string;
  photos: AvatarPhotoDTO[];
  createdAt: string;
  updatedAt: string;
}

export interface JobItemDTO {
  id: string;
  kind: ItemKind;
  variation: number;
  status: ItemStatus;
  attempts: number;
  url: string | null;
  isPlaceholder: boolean;
  error: string | null;
}

export interface JobDTO {
  id: string;
  title: string;
  status: JobStatus;
  phase: JobPhase;
  videoId: string | null;
  videoName: string | null;
  /** null = "Pessoa original" (mantém a pessoa do vídeo, sem trocar por avatar). */
  avatarId: string | null;
  avatarName: string;
  format: FormatId;
  /** Quantidade de variações = nº de vídeos = nº de imagens-base planejados. */
  variations: number;
  model: ModelId;
  resolution: ResolutionId;
  language: string;
  maxGenerations: number;
  generationsUsed: number;
  videosDone: number;
  videosFailed: number;
  imagesDone: number;
  imagesFailed: number;
  /** Total de tentativas que falharam (inclui as que foram refeitas com sucesso). */
  failedAttempts: number;
  /** Itens (imagens + vídeos) que ainda não terminaram. */
  itemsOpen: number;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** Miniatura: primeira imagem-base pronta, se houver. */
  thumbnailUrl: string | null;
}

export interface JobDetailDTO extends JobDTO {
  avatarDescription: string;
  transcript: string;
  transcriptSource: TranscriptSource;
  copyText: string;
  items: JobItemDTO[];
}

export type AccountAvailability = 'available' | 'disabled' | 'low_credits' | 'cycle_exhausted';

export interface GoogleAccountDTO {
  id: string;
  email: string;
  /** Nome exibido: rótulo definido pelo usuário ou a parte local do e-mail. */
  name: string;
  /** Saldo de créditos no Flow. */
  credits: number;
  /** Créditos reservados por gerações em andamento (fase 2: calculado a partir dos itens ativos). */
  reservedCredits: number;
  availableCredits: number;
  /** "Usar na rotação". */
  enabled: boolean;
  /** Posição na ordem de uso (1 = primeira). */
  priority: number;
  cycleVideos: number;
  cycleImages: number;
  totalVideos: number;
  totalImages: number;
  lastUsedAt: string | null;
  creditsUpdatedAt: string | null;
  availability: AccountAvailability;
  /** Há um Chrome online com a aba do Flow logada nesta conta. */
  sessionActive: boolean;
}

export interface AccountsOverviewDTO {
  accounts: GoogleAccountDTO[];
  total: number;
  eligible: number;
  openSessions: number;
  rotation: RotationStateDTO;
}

export interface GeminiKeyDTO {
  id: string;
  /** Posição na ordem de tentativa (1 = primeira). */
  position: number;
  /** Chave mascarada — o valor completo nunca volta para o navegador. */
  maskedKey: string;
  uses: number;
  lastUsedAt: string | null;
  lastError: string | null;
}

export interface RotationStateDTO {
  cycle: number;
  cycleStartedAt: string;
}

export interface BrowserDTO {
  id: string;
  name: string;
  version: string | null;
  /** Sinal recebido há menos de 90 s. */
  online: boolean;
  flowSessionActive: boolean;
  flowAccountEmail: string | null;
  pairedAt: string;
  lastSeenAt: string;
}

export interface PairingCodeDTO {
  /** Formatado como XXXX-XXXX. */
  code: string;
  browserName: string;
  expiresAt: string;
}

export interface ExtensionOverviewDTO {
  browsers: BrowserDTO[];
  onlineCount: number;
  /** Algum Chrome online reporta uma aba do Flow com sessão ativa. */
  flowSessionActive: boolean;
  pairingCode: PairingCodeDTO | null;
}

export interface StorageUsageDTO {
  usedBytes: number;
  quotaBytes: number;
  availableBytes: number;
  /** Inteiro 0–100. */
  percent: number;
}

export interface PublicSettingsDTO {
  whisperBaseUrl: string;
  whisperModel: string;
  whisperApiKeyMasked: string | null;
  whisperConfigured: boolean;
  geminiPromptModel: string;
  geminiKeysCount: number;
  storageDir: string;
  storageDirIsDefault: boolean;
}
