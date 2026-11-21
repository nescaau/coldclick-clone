/** Esquemas zod das entradas da API — a única fonte de verdade da validação de formato. */
import { z } from 'zod';
import {
  formatIds,
  isResolutionAllowed,
  languageIds,
  MAX_VARIATIONS,
  MIN_VARIATIONS,
  modelIds,
  resolutionIds,
} from './catalog';
import { MAX_GEMINI_KEYS } from './config';

export const createJobSchema = z
  .object({
    title: z.string().trim().max(120).optional(),
    videoId: z.string().min(1, 'Selecione um vídeo'),
    /** null = "Pessoa original": mantém a pessoa do vídeo, sem trocar por um avatar. */
    avatarId: z.string().min(1).nullable(),
    /** Fala transcrita do vídeo (Whisper), guardada como referência. */
    transcript: z.string().max(50_000).default(''),
    transcriptSource: z.enum(['whisper', 'manual', 'none']).default('none'),
    /** Copy final usada na geração (a transcrição, editada, ou escrita à mão). */
    copyText: z.string().trim().min(1, 'Informe a copy do vídeo').max(20_000),
    language: z.enum(languageIds).default('pt'),
    format: z.enum(formatIds),
    variations: z.number().int().min(MIN_VARIATIONS).max(MAX_VARIATIONS),
    model: z.enum(modelIds),
    resolution: z.enum(resolutionIds),
  })
  .superRefine((v, ctx) => {
    if (!isResolutionAllowed(v.model, v.resolution)) {
      ctx.addIssue({ code: 'custom', path: ['resolution'], message: '360p só está disponível com Omni 1.1 Flash.' });
    }
  });
export type CreateJobInput = z.infer<typeof createJobSchema>;

export const transcribeSchema = z.object({ language: z.enum(languageIds).default('pt') });
export const importVideoSchema = z.object({ url: z.string().trim().url('Informe uma URL válida') });

export const settingsSchema = z.object({
  whisperBaseUrl: z.string().max(300).optional(),
  whisperModel: z.string().max(100).optional(),
  whisperApiKey: z.string().max(500).optional(),
  geminiPromptModel: z.string().max(100).optional(),
  storageDir: z.string().max(500).optional(),
});

export const addAccountSchema = z.object({
  email: z.string().trim().email('E-mail inválido'),
  label: z.string().trim().max(80).optional(),
  credits: z.number().int().min(0).max(1_000_000).default(0),
});

export const updateAccountSchema = z.object({
  label: z.string().trim().max(80).nullable().optional(),
  credits: z.number().int().min(0).max(1_000_000).optional(),
  enabled: z.boolean().optional(),
  /** Mover na ordem de prioridade. */
  move: z.enum(['up', 'down']).optional(),
});

export const rotationActionSchema = z.discriminatedUnion('action', [
  /** Dry-run: como N gerações seriam distribuídas entre as contas (não grava nada). */
  z.object({ action: z.literal('preview'), kind: z.enum(['video', 'image']), count: z.number().int().min(1).max(200) }),
  /** Força o início de um novo ciclo (zera os contadores de todas as contas). */
  z.object({ action: z.literal('advance') }),
]);

export const addGeminiKeysSchema = z.object({
  /** Uma chave por linha. */
  keys: z.string().min(1, 'Cole ao menos uma chave').max(MAX_GEMINI_KEYS * 400),
});

export const moveSchema = z.object({ move: z.enum(['up', 'down']) });

export const createPairingSchema = z.object({
  browserName: z.string().trim().min(1).max(80).default('Chrome deste dispositivo'),
});

export const pairSchema = z.object({
  code: z.string().trim().min(8).max(12),
  /** Mantido por compatibilidade: o nome do navegador vem do código de pareamento. */
  deviceName: z.string().trim().max(80).optional(),
  version: z.string().trim().max(20).optional(),
});

export const heartbeatSchema = z
  .object({
    version: z.string().trim().max(20).optional(),
    flowSessionActive: z.boolean().optional(),
    flowAccountEmail: z.string().trim().email().nullable().optional(),
  })
  .default({});
