/**
 * Schemas zod — FONTE ÚNICA das regras de entrada (rotas e serviços validam com estes; a UI reaproveita os limites).
 */
import { z } from 'zod';
import {
  MAX_AVATAR_DESCRIPTION,
  MAX_AVATAR_NAME,
  MAX_CONVERSATION_TITLE,
  MAX_FEEDBACK_CHARS,
  MAX_MESSAGE_CHARS,
  MAX_QUANTITY,
} from './limits';
import { LANGUAGES, normalizeHex } from './domain/video-options';

const languageIds = LANGUAGES.map((l) => l.id) as [string, ...string[]];

export const VideoOptionsPatchSchema = z
  .object({
    word: z.string().max(80),
    batchName: z.string().max(80),
    bubbleOn: z.boolean(),
    bubbleColor: z.string().refine((v) => normalizeHex(v) !== undefined, 'Cor inválida (use #RRGGBB)'),
    language: z.enum(languageIds),
  })
  .partial();

export const ConversationPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(MAX_CONVERSATION_TITLE),
    mode: z.enum(['viral', 'ideia']),
    /** null tira o viral da conversa; id coloca um viral já enviado. */
    viralId: z.string().min(1).nullable(),
    options: VideoOptionsPatchSchema,
  })
  .partial();

export const SendMessageSchema = z.object({
  text: z.string().max(MAX_MESSAGE_CHARS),
  /** Nomes dos anexos (📎). Nesta fase só o nome é guardado — o arquivo não é enviado a lugar nenhum. */
  attachments: z.array(z.object({ nome: z.string().max(200) })).max(8).default([]),
});

export const ManualBatchSchema = z.object({
  viralId: z.string().min(1),
  quantity: z.number().int().min(1).max(MAX_QUANTITY),
  options: VideoOptionsPatchSchema.default({}),
});

export const AvatarSchema = z.object({
  name: z.string().trim().min(1, 'Dê um nome ao avatar').max(MAX_AVATAR_NAME),
  description: z.string().trim().max(MAX_AVATAR_DESCRIPTION).default(''),
});

export const SettingsPatchSchema = z
  .object({
    autoSwitch: z.boolean(),
    minCredits: z.number().int().min(0).max(100000),
  })
  .partial();

export const FeedbackSchema = z.object({
  kind: z.enum(['bug', 'sugestao']),
  text: z.string().trim().min(3, 'Conte um pouco mais').max(MAX_FEEDBACK_CHARS),
});
