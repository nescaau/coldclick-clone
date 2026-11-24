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
import { ANALYSIS_LIMITS } from './domain/analysis';
import { SUBTITLE_FONTS, SUBTITLE_POSITIONS, SUBTITLE_STYLES } from './domain/settings';

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

export const ConversationCreateSchema = z.object({ mode: z.enum(['viral', 'ideia']).optional() });

export const SendMessageSchema = z.object({
  text: z.string().max(MAX_MESSAGE_CHARS),
  /** Nomes dos anexos (📎). Nesta fase só o nome é guardado — o arquivo não é enviado a lugar nenhum. */
  attachments: z.array(z.object({ nome: z.string().max(200) })).max(8).default([]),
});

export const ManualBatchSchema = z.object({
  viralId: z.string().min(1),
  quantity: z.number().int().min(1).max(MAX_QUANTITY),
  path: z.enum(['igual', 'adaptar']).default('igual'),
  variation: z.enum(['sem', 'roleta', 'gesto', 'texto', 'combinada', 'novo']).default('sem'),
  /** Avatares marcados na biblioteca ("QUEM APARECE E QUANTOS?"). */
  avatarIds: z.array(z.string().min(1)).max(50).default([]),
  /** "🎲 N avatares novos". */
  newAvatars: z.number().int().min(0).max(MAX_QUANTITY).default(0),
  options: VideoOptionsPatchSchema.default({}),
  /** "observações (opcional) — o que você escrever aqui é lei pros roteiros e pras cenas". */
  notes: z.string().max(1500).default(''),
});

export const AvatarSchema = z.object({
  name: z.string().trim().min(1, 'Dê um nome ao avatar').max(MAX_AVATAR_NAME),
  description: z.string().trim().max(MAX_AVATAR_DESCRIPTION).default(''),
  gender: z.enum(['', 'mulher', 'homem']).default(''),
});

export const AvatarGenerateSchema = z.object({ count: z.number().int().min(1).max(4) });
export const AvatarBulkDeleteSchema = z.object({ ids: z.array(z.string().min(1)).min(1).max(200) });

/** Corrigir a leitura ("Alterar análise"): campos e limites do formulário do original. */
export const AnalysisSchema = z.object({
  pessoas: z
    .array(
      z.object({
        sexo: z.enum(['', 'f', 'm']),
        fala: z.boolean(),
        descricao: z.string().max(ANALYSIS_LIMITS.descricao),
        roupa: z.string().max(ANALYSIS_LIMITS.roupa),
      }),
    )
    .max(ANALYSIS_LIMITS.pessoas),
  rosto: z.boolean(),
  legenda: z.boolean(),
  tela: z.string().max(ANALYSIS_LIMITS.tela),
  acoes: z.string().max(ANALYSIS_LIMITS.acoes),
  transcricao: z.string().max(ANALYSIS_LIMITS.transcricao),
  estrutura: z.string().max(ANALYSIS_LIMITS.estrutura),
  enquadramento: z.string().max(ANALYSIS_LIMITS.enquadramento),
});

export const SettingsPatchSchema = z
  .object({
    autoSwitch: z.boolean(),
    minCredits: z.number().int().min(0).max(100000),
    parallel: z.number().int().min(1).max(4),
    imageModel: z.string().max(60),
    flowCopy: z.boolean(),
    autoApprove: z.boolean(),
    simulation: z.boolean(),
    simFailEvery: z.number().int().min(0).max(20),
    subtitle: z
      .object({
        color: z.string().refine((v) => normalizeHex(v) !== undefined, 'Cor inválida (use #RRGGBB)'),
        alternate: z.boolean(),
        words: z.number().int(),
        style: z.enum(SUBTITLE_STYLES),
        position: z.enum(SUBTITLE_POSITIONS),
        height: z.number().min(0).max(100),
        size: z.number().min(50).max(200),
        font: z.enum(SUBTITLE_FONTS),
        saved: z.boolean(),
      })
      .partial(),
  })
  .partial();

export const ApiKeySchema = z.object({ key: z.string().trim().min(8, 'Cole a chave inteira.').max(300) });

export const FeedbackSchema = z.object({
  kind: z.enum(['bug', 'sugestao']),
  text: z.string().trim().min(3, 'Conte um pouco mais').max(MAX_FEEDBACK_CHARS),
});
