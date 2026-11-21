/** Esquemas zod das entradas da API — a única fonte de verdade da validação de formato. */
import { z } from 'zod';
import {
  creativeFormatIds,
  imageModelIds,
  isResolutionAllowed,
  MAX_COPY_CHARS,
  MAX_VARIATIONS,
  modelIds,
  outputLanguageIds,
  resolutionIds,
  scriptModeIds,
} from './catalog';
import { MAX_GEMINI_KEYS } from './config';

const axisChoiceSchema = z.object({
  mode: z.enum(['original', 'preset', 'describe']),
  value: z.string().trim().max(300).default(''),
});

const sceneSchema = z.object({
  index: z.number().int().min(1),
  start: z.number().min(0),
  end: z.number().min(0),
  text: z.string().trim().min(1, 'Uma cena está vazia').max(MAX_COPY_CHARS),
});

/**
 * Entrada de "Preparar geração"/"Disparar". As SAÍDAS (variações) não vêm do cliente: são o nº de
 * avatares escolhidos (ou 1 para "Pessoa original"), calculado no serviço.
 */
export const createJobSchema = z
  .object({
    title: z.string().trim().max(120).optional(),
    videoId: z.string().min(1, 'Selecione um vídeo'),
    /** Vazio = "Pessoa original": mantém a pessoa do vídeo, sem trocar por avatar. */
    avatarIds: z.array(z.string().min(1)).max(MAX_VARIATIONS).default([]),
    product: z.string().trim().max(120).nullable().default(null),
    creativeFormat: z.enum(creativeFormatIds).default('original-recipe'),
    scriptMode: z.enum(scriptModeIds).default('keep'),
    outputLanguage: z.enum(outputLanguageIds).default('original'),
    axes: z
      .object({ outfit: axisChoiceSchema, scenery: axisChoiceSchema, object: axisChoiceSchema })
      .default({ outfit: { mode: 'original', value: '' }, scenery: { mode: 'original', value: '' }, object: { mode: 'original', value: '' } }),
    imageModel: z.enum(imageModelIds).default('nano-banana-2.1'),
    /** Texto da chamada para ação; vazio = sem CTA. */
    cta: z.string().trim().max(200).default(''),
    /** Fala transcrita do vídeo (referência) e a origem dela. */
    transcript: z.string().max(MAX_COPY_CHARS).default(''),
    transcriptSource: z.enum(['whisper', 'manual', 'none']).default('none'),
    scenes: z.array(sceneSchema).max(100).default([]),
    /** Copy final (todas as cenas juntas, ou o texto escrito à mão). */
    copyText: z.string().trim().min(1, 'Informe a copy do vídeo').max(MAX_COPY_CHARS, `A copy pode ter no máximo ${MAX_COPY_CHARS} caracteres`),
    model: z.enum(modelIds),
    resolution: z.enum(resolutionIds),
  })
  .superRefine((v, ctx) => {
    if (!isResolutionAllowed(v.model, v.resolution)) {
      ctx.addIssue({ code: 'custom', path: ['resolution'], message: '360p só está disponível com Omni 1.1 Flash.' });
    }
    for (const [axis, choice] of Object.entries(v.axes)) {
      if (choice.mode !== 'original' && !choice.value.trim()) {
        ctx.addIssue({ code: 'custom', path: ['axes', axis], message: 'Escolha um preset ou descreva a variação.' });
      }
    }
    if (new Set(v.avatarIds).size !== v.avatarIds.length) {
      ctx.addIssue({ code: 'custom', path: ['avatarIds'], message: 'Avatares repetidos.' });
    }
  });
export type CreateJobInput = z.infer<typeof createJobSchema>;

export const transcribeSchema = z.object({ videoId: z.string().min(1, 'Selecione um vídeo') });
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
