/**
 * Configuração (⚙) — valores, opções e saneamento. Rótulos literais de ref-zerum-config.snap.txt.
 * Tudo é preferência LOCAL (SQLite). Nada aqui chama serviço externo.
 */
import { normalizeHex } from './video-options';

export const PARALLEL_OPTIONS = [1, 2, 3, 4] as const;
export const DEFAULT_PARALLEL = 4;
/** Selects reais do ⚙ (r11-config.snap.txt): "Imagem" = estes 3 nomes, nesta ordem. */
export const IMAGE_MODEL_OPTIONS = ['Nano Banana Pro', 'Nano Banana 2', 'Nano Banana 2 Lite'] as const;
export const DEFAULT_IMAGE_MODEL: (typeof IMAGE_MODEL_OPTIONS)[number] = 'Nano Banana Pro';

/** Valor salvo na versão anterior deste clone ("Nano Banana Lite", sem o "2") → nome real. Qualquer outro valor desconhecido volta ao padrão. */
export const normalizeImageModel = (v: unknown): string =>
  v === 'Nano Banana Lite' ? 'Nano Banana 2 Lite' : (IMAGE_MODEL_OPTIONS as readonly unknown[]).includes(v) ? (v as string) : DEFAULT_IMAGE_MODEL;

/** Sufixo do modelo de imagem no "PEDIDO": só o Pro leva "(melhor rosto)", o 2 Lite leva "(rápido)" e o Nano Banana 2 vai sem sufixo. */
export const imageModelSuffix = (model: string): string => (model === 'Nano Banana Pro' ? ' (melhor rosto)' : model === 'Nano Banana 2 Lite' ? ' (rápido)' : '');

/**
 * "INTELIGÊNCIA" (⚙): as duas opções literais do original. Neste clone é só uma PREFERÊNCIA guardada ("cérebro" local):
 * o Diretor é local e não chama IA nenhuma (sem Antigravity), então a escolha ainda não muda nada.
 */
export const BRAIN_OPTIONS = ['Gemini 3.8 Flash (High) (padrão e recomendado)', 'Claude Opus 5.5 (Medium)'] as const;
export const DEFAULT_BRAIN: (typeof BRAIN_OPTIONS)[number] = BRAIN_OPTIONS[0];
export const normalizeBrain = (v: unknown): string => ((BRAIN_OPTIONS as readonly unknown[]).includes(v) ? (v as string) : DEFAULT_BRAIN);

/** Cores da palavra em destaque (ordem literal do snap). `#FFFF00` = Amarelo padrão da legenda. */
export const SUBTITLE_COLORS = [
  { nome: 'Amarelo', hex: '#FFFF00' },
  { nome: 'Branco', hex: '#FFFFFF' },
  { nome: 'Verde', hex: '#22C55E' },
  { nome: 'Vermelho', hex: '#EF4444' },
  { nome: 'Azul', hex: '#3B82F6' },
  { nome: 'Rosa', hex: '#F65CB4' },
  { nome: 'Laranja', hex: '#FF7A00' },
  { nome: 'Ciano', hex: '#22D3EE' },
] as const;
export const ALT_COLOR_LABEL = 'Cor alternada: branco e amarelo';

export const SUBTITLE_WORDS = [1, 3, 5] as const;
export const SUBTITLE_STYLES = ['legenda', 'karaokê'] as const;
export const SUBTITLE_POSITIONS = ['embaixo', 'no meio', 'em cima'] as const;
export const SUBTITLE_FONTS = ['Poppins Bold', 'Anton', 'Bebas Neue', 'Archivo Black', 'Lilita One', 'Bangers'] as const;

export interface SubtitleSettings {
  color: string;
  /** "Cor alternada: branco e amarelo". */
  alternate: boolean;
  words: number;
  style: (typeof SUBTITLE_STYLES)[number];
  position: (typeof SUBTITLE_POSITIONS)[number];
  /** "altura da legenda" (0–100). */
  height: number;
  /** "Tamanho · 100 %". */
  size: number;
  font: (typeof SUBTITLE_FONTS)[number];
  /** "★ Salvar como padrão" já foi clicado. */
  saved: boolean;
}

export const DEFAULT_SUBTITLE: SubtitleSettings = {
  color: '#FFFF00',
  alternate: false,
  words: 3,
  style: 'legenda',
  position: 'embaixo',
  height: 10,
  size: 100,
  font: 'Poppins Bold',
  saved: false,
};

export function sanitizeSubtitle(patch: Partial<SubtitleSettings>, current: SubtitleSettings): SubtitleSettings {
  const n: SubtitleSettings = { ...current };
  if (patch.color !== undefined) n.color = normalizeHex(patch.color) ?? current.color;
  if (patch.alternate !== undefined) n.alternate = !!patch.alternate;
  if (patch.words !== undefined && (SUBTITLE_WORDS as readonly number[]).includes(patch.words)) n.words = patch.words;
  if (patch.style !== undefined && (SUBTITLE_STYLES as readonly string[]).includes(patch.style)) n.style = patch.style;
  if (patch.position !== undefined && (SUBTITLE_POSITIONS as readonly string[]).includes(patch.position)) n.position = patch.position;
  if (patch.font !== undefined && (SUBTITLE_FONTS as readonly string[]).includes(patch.font)) n.font = patch.font;
  if (patch.height !== undefined && Number.isFinite(patch.height)) n.height = Math.max(0, Math.min(100, Math.round(patch.height)));
  if (patch.size !== undefined && Number.isFinite(patch.size)) n.size = Math.max(50, Math.min(200, Math.round(patch.size)));
  if (patch.saved !== undefined) n.saved = !!patch.saved;
  return n;
}

/** "••••1234": só os 4 últimos caracteres da chave aparecem; a chave inteira nunca volta para a tela. */
export const maskKey = (key: string): string => `••••${key.slice(-4)}`;
