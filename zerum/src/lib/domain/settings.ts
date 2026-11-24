/**
 * Configuração (⚙) — valores, opções e saneamento. Rótulos literais de ref-zerum-config.snap.txt.
 * Tudo é preferência LOCAL (SQLite). Nada aqui chama serviço externo.
 */
import { normalizeHex } from './video-options';

export const PARALLEL_OPTIONS = [1, 2, 3, 4] as const;
export const DEFAULT_PARALLEL = 4;
export const IMAGE_MODEL_OPTIONS = ['Nano Banana Pro', 'Nano Banana 2', 'Nano Banana Lite'] as const;

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
