/** Tipos trafegados entre API e interface (DTOs). Datas = ISO-8601 UTC. */
import type { DirectorMode } from './domain/director';
import type { VideoOptions, LanguageId } from './domain/video-options';

export type { DirectorMode, VideoOptions, LanguageId };

export interface ViralDTO {
  id: string;
  name: string;
  sizeBytes: number;
  /** 'preparando' = guardado localmente; a análise do Diretor é fase futura. */
  state: 'preparando' | 'analisado';
  createdAt: string;
}

export type MessageRole = 'aluna' | 'diretor' | 'sistema';

export interface MessageDTO {
  id: string;
  role: MessageRole;
  text: string;
  attachments: { nome: string }[];
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

export type BatchState = 'preparando' | 'na_fila' | 'rodando' | 'pronto' | 'falhou' | 'cancelado';

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
  createdAt: string;
}

export interface SettingsDTO {
  /** "Troca automática de conta" (painel Contas Flow). Só preferência: sem executor nesta fase. */
  autoSwitch: boolean;
  /** "Trocar abaixo de créditos" (padrão 20, como no original). */
  minCredits: number;
}

export const DEFAULT_SETTINGS: SettingsDTO = { autoSwitch: false, minCredits: 20 };

export interface SendMessageResult {
  conversation: ConversationDetail;
  batch: BatchDTO | null;
}
