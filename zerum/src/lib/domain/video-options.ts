/**
 * Opções do vídeo (painel "⚙ Opções do vídeo") — regras puras, sem I/O.
 * Valores e textos seguem o app original (cores com hex literais, "Até 40 letras/números", etc.).
 */
import { MAX_BATCH_NAME, MAX_WORD } from '../limits';

export const DEFAULT_BALLOON_COLOR = '#FFC400';

/** Cores do balão, na mesma ordem do original (Amarelo é o padrão). */
export const BALLOON_COLORS = [
  { nome: 'Amarelo', hex: '#FFC400' },
  { nome: 'Verde', hex: '#22C55E' },
  { nome: 'Vermelho', hex: '#EF4444' },
  { nome: 'Azul', hex: '#3B82F6' },
  { nome: 'Rosa', hex: '#F65CB4' },
  { nome: 'Laranja', hex: '#FF7A00' },
  { nome: 'Branco', hex: '#FFFFFF' },
  { nome: 'Preto', hex: '#141414' },
] as const;

export const LANGUAGES = [
  { id: 'en', nome: 'Inglês' },
  { id: 'de', nome: 'Alemão' },
  { id: 'es', nome: 'Espanhol' },
] as const;
export type LanguageId = (typeof LANGUAGES)[number]['id'];
export const DEFAULT_LANGUAGE: LanguageId = 'en';

export interface VideoOptions {
  /** Palavra do comentário (a "palavra da automação"): aparece no balão COMMENT "PALAVRA". */
  word: string;
  /** Nome do lote: prefixo do arquivo baixado (Nome_12345.mp4). */
  batchName: string;
  bubbleOn: boolean;
  bubbleColor: string;
  language: LanguageId;
}

export const DEFAULT_OPTIONS: VideoOptions = {
  word: '',
  batchName: '',
  bubbleOn: true,
  bubbleColor: DEFAULT_BALLOON_COLOR,
  language: DEFAULT_LANGUAGE,
};

/** "#abc" / "abc" / "#AABBCC" → "#AABBCC". Qualquer outra coisa → undefined. */
export function normalizeHex(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined;
  const v = input.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(v)) {
    return ('#' + v.split('').map((c) => c + c).join('')).toUpperCase();
  }
  if (/^[0-9a-f]{6}$/i.test(v)) return ('#' + v).toUpperCase();
  return undefined;
}

/** Texto preto ou branco, conforme a luminância do fundo: "o texto do balão ajusta o contraste sozinho". */
export function contrastText(hex: string): '#000000' | '#FFFFFF' {
  const h = normalizeHex(hex) ?? DEFAULT_BALLOON_COLOR;
  const r = parseInt(h.slice(1, 3), 16);
  const g = parseInt(h.slice(3, 5), 16);
  const b = parseInt(h.slice(5, 7), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#000000' : '#FFFFFF';
}

const stripAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Só letras/números, sem acento, até 40 — vira o prefixo do arquivo (Nome_12345.mp4). */
export function sanitizeBatchName(raw: string): string {
  return stripAccents(String(raw ?? ''))
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, MAX_BATCH_NAME);
}

/** Palavra do comentário: letras/números sem acento, até 24, guardada como digitada (a UI exibe em maiúsculas). */
export function sanitizeWord(raw: string): string {
  return stripAccents(String(raw ?? ''))
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, MAX_WORD);
}

/** Texto do balão: COMMENT "PALAVRA" (placeholder quando não há palavra). */
export const balloonLabel = (word: string): string => `COMMENT "${word.trim().toUpperCase() || 'PALAVRA'}"`;

/** "sem palavra · balão ligado" — resumo mostrado ao lado de "Opções do vídeo" (o original monta só palavra · balão). */
export function optionsSummary(o: Pick<VideoOptions, 'word' | 'bubbleOn'>): string {
  return `${o.word.trim() ? `palavra "${o.word.trim().toUpperCase()}"` : 'sem palavra'} · balão ${o.bubbleOn ? 'ligado' : 'desligado'}`;
}

/** Aplica sanitização/validação em opções parciais vindas da API, sobre as opções atuais. */
export function mergeOptions(current: VideoOptions, patch: Partial<VideoOptions>): VideoOptions {
  const next: VideoOptions = { ...current };
  if (patch.word !== undefined) next.word = sanitizeWord(patch.word);
  if (patch.batchName !== undefined) next.batchName = sanitizeBatchName(patch.batchName);
  if (patch.bubbleOn !== undefined) next.bubbleOn = !!patch.bubbleOn;
  if (patch.bubbleColor !== undefined) next.bubbleColor = normalizeHex(patch.bubbleColor) ?? current.bubbleColor;
  if (patch.language !== undefined && LANGUAGES.some((l) => l.id === patch.language)) next.language = patch.language;
  return next;
}

export const languageName = (id: LanguageId): string => LANGUAGES.find((l) => l.id === id)?.nome ?? id;
