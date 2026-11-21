/**
 * Catálogo de opções do estúdio (formatos, modelos, resoluções, idiomas).
 * Seguro para uso no cliente e no servidor (sem imports de Node).
 */

export const FORMATS = [
  { id: '9:16', label: '9:16', hint: 'Vertical · Reels, TikTok, Shorts', ratio: 9 / 16 },
  { id: '1:1', label: '1:1', hint: 'Quadrado · Feed', ratio: 1 },
  { id: '16:9', label: '16:9', hint: 'Horizontal · YouTube', ratio: 16 / 9 },
] as const;
export type FormatId = (typeof FORMATS)[number]['id'];

/** Ordem e rótulos idênticos aos da lista de modelos da plataforma de referência. */
export const MODELS = [
  { id: 'veo-3.1-fast', label: 'Veo 3.1 - Fast' },
  { id: 'veo-3.1-fast-lp', label: 'Veo 3.1 - Fast [Lower Priority]' },
  { id: 'veo-3.1-lite', label: 'Veo 3.1 - Lite' },
  { id: 'omni-1.1-flash', label: 'Omni 1.1 Flash' },
  { id: 'veo-3.1-quality', label: 'Veo 3.1 - Quality' },
] as const;
export type ModelId = (typeof MODELS)[number]['id'];
export const DEFAULT_MODEL: ModelId = 'veo-3.1-lite';

export const RESOLUTIONS = [
  { id: '720p', label: '720p' },
  { id: '360p', label: '360p' },
] as const;
export type ResolutionId = (typeof RESOLUTIONS)[number]['id'];

/** Regra da plataforma: 360p só existe no Omni 1.1 Flash. */
export const OMNI_ONLY_RESOLUTION: ResolutionId = '360p';
export const OMNI_MODEL: ModelId = 'omni-1.1-flash';

export const isResolutionAllowed = (model: ModelId, resolution: ResolutionId): boolean =>
  resolution !== OMNI_ONLY_RESOLUTION || model === OMNI_MODEL;

/** "Idioma do vídeo" (idioma de saída): mantém o original ou converte a fala. */
export const OUTPUT_LANGUAGES = [
  { id: 'original', label: 'Original' },
  { id: 'en', label: 'Inglês' },
  { id: 'es', label: 'Espanhol' },
  { id: 'pt', label: 'Português' },
] as const;
export type OutputLanguageId = (typeof OUTPUT_LANGUAGES)[number]['id'];

/** Rótulos de idiomas de trabalhos antigos (fase 1) continuam legíveis. */
const LEGACY_LANGUAGE_LABELS: Record<string, string> = { fr: 'Francês', it: 'Italiano', de: 'Alemão', auto: 'Original' };
export const outputLanguageLabel = (id: string): string =>
  OUTPUT_LANGUAGES.find((l) => l.id === id)?.label ?? LEGACY_LANGUAGE_LABELS[id] ?? id;

export const SCRIPT_MODES = [
  { id: 'keep', label: 'Manter a fala' },
  { id: 'adapt', label: 'Adaptar a fala' },
  { id: 'new', label: 'Criar fala nova' },
] as const;
export type ScriptModeId = (typeof SCRIPT_MODES)[number]['id'];

/** Formato criativo (estilo da cena), na ordem da plataforma de referência. */
export const CREATIVE_FORMATS = [
  { id: 'original-recipe', label: 'Receita original' },
  { id: 'split-screen', label: 'Tela dividida' },
  { id: 'car-selfie', label: 'Selfie no carro' },
  { id: 'home-selfie', label: 'Selfie em casa' },
  { id: 'american-kitchen', label: 'Cozinha americana' },
  { id: 'podcast', label: 'Podcast' },
  { id: 'mirror-selfie', label: 'Selfie no espelho' },
  { id: 'before-after', label: 'Antes e depois' },
  { id: 'doctor-office', label: 'Médico no consultório' },
  { id: 'pov-hands', label: 'POV — somente mãos' },
  { id: 'ugc-testimonial', label: 'Depoimento UGC' },
  { id: 'fat-melting', label: 'Gordura derretendo (rascunho)' },
] as const;
export type CreativeFormatId = (typeof CREATIVE_FORMATS)[number]['id'];

export const IMAGE_MODELS = [
  { id: 'nano-banana-2.1', label: '🍌 Nano Banana 2.1' },
  { id: 'nano-banana-pro', label: '🍌 Nano Banana Pro' },
  { id: 'nano-banana-2-lite', label: '🍌 Nano Banana 2 Lite' },
] as const;
export type ImageModelId = (typeof IMAGE_MODELS)[number]['id'];

/** Chamada para ação (CTA). `text: ''` = sem CTA; a última opção é um texto livre. */
export const CTA_PRESETS = [
  { id: 'none', label: 'Sem CTA', text: '' },
  { id: 'full-video', label: 'Comente para receber o vídeo completo', text: 'Comente para receber o vídeo completo' },
  { id: 'recipe', label: 'Comente e eu envio a receita', text: 'Comente e eu envio a receita' },
] as const;
export const CTA_CUSTOM_LABEL = 'Digite a minha chamada…';

/**
 * Eixos de variação visual. Cada eixo pode manter o original, usar um preset ou seguir uma descrição.
 * A lista de presets é local desta réplica (a plataforma original não expõe o conteúdo dela).
 */
export const AXES = [
  { id: 'outfit', label: 'Roupa', article: 'A', presets: ['Casual do dia a dia', 'Roupa esportiva', 'Social elegante', 'Jaleco branco'] },
  { id: 'scenery', label: 'Cenário', article: 'A', presets: ['Cozinha moderna', 'Sala de estar', 'Quarto aconchegante', 'Varanda ensolarada'] },
  { id: 'object', label: 'Objeto', article: 'A', presets: ['Frasco de suplemento', 'Garrafa de água', 'Cápsulas na mão', 'Caixa do produto'] },
] as const;
export type AxisId = (typeof AXES)[number]['id'];
export const AXIS_MODES = [
  { id: 'original', label: 'Original' },
  { id: 'preset', label: 'Preset' },
  { id: 'describe', label: 'Descrever' },
] as const;
export type AxisModeId = (typeof AXIS_MODES)[number]['id'];

export interface AxisChoice {
  mode: AxisModeId;
  /** Preset escolhido ou descrição livre (vazio quando `mode` é "original"). */
  value: string;
}
export type AxesChoice = Record<AxisId, AxisChoice>;

export const DEFAULT_AXES: AxesChoice = {
  outfit: { mode: 'original', value: '' },
  scenery: { mode: 'original', value: '' },
  object: { mode: 'original', value: '' },
};

/** Resumo dos eixos para a Revisão ("Nenhum · manter os elementos originais"). */
export function describeAxes(axes: AxesChoice): string {
  const changed = AXES.filter((a) => axes[a.id].mode !== 'original');
  if (changed.length === 0) return 'Nenhum · manter os elementos originais';
  return changed.map((a) => `${a.label}: ${axes[a.id].value || '—'}`).join(' · ');
}

export const MIN_VARIATIONS = 1;
export const MAX_VARIATIONS = 50;
/** Limite de caracteres da copy falada. */
export const MAX_COPY_CHARS = 12_000;

export const formatIds = FORMATS.map((f) => f.id) as [FormatId, ...FormatId[]];
export const modelIds = MODELS.map((m) => m.id) as [ModelId, ...ModelId[]];
export const resolutionIds = RESOLUTIONS.map((r) => r.id) as [ResolutionId, ...ResolutionId[]];
export const outputLanguageIds = OUTPUT_LANGUAGES.map((l) => l.id) as [OutputLanguageId, ...OutputLanguageId[]];
export const scriptModeIds = SCRIPT_MODES.map((m) => m.id) as [ScriptModeId, ...ScriptModeId[]];
export const creativeFormatIds = CREATIVE_FORMATS.map((f) => f.id) as [CreativeFormatId, ...CreativeFormatId[]];
export const imageModelIds = IMAGE_MODELS.map((m) => m.id) as [ImageModelId, ...ImageModelId[]];

export const labelOf = <T extends { id: string; label: string }>(list: readonly T[], id: string): string =>
  list.find((i) => i.id === id)?.label ?? id;
