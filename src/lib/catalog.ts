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

/** Códigos ISO-639-1 (o formato que a API de transcrição espera). */
export const LANGUAGES = [
  { id: 'pt', label: 'Português (Brasil)' },
  { id: 'en', label: 'English' },
  { id: 'es', label: 'Español' },
  { id: 'fr', label: 'Français' },
  { id: 'it', label: 'Italiano' },
  { id: 'de', label: 'Deutsch' },
  { id: 'auto', label: 'Detectar automaticamente' },
] as const;
export type LanguageId = (typeof LANGUAGES)[number]['id'];

export const MIN_VARIATIONS = 1;
export const MAX_VARIATIONS = 50;

export const formatIds = FORMATS.map((f) => f.id) as [FormatId, ...FormatId[]];
export const modelIds = MODELS.map((m) => m.id) as [ModelId, ...ModelId[]];
export const resolutionIds = RESOLUTIONS.map((r) => r.id) as [ResolutionId, ...ResolutionId[]];
export const languageIds = LANGUAGES.map((l) => l.id) as [LanguageId, ...LanguageId[]];

export const labelOf = <T extends { id: string; label: string }>(list: readonly T[], id: string): string =>
  list.find((i) => i.id === id)?.label ?? id;
