/**
 * Regras puras do Diretor (o chat que monta lotes): título da conversa, quantidade pedida,
 * placeholder do campo de pedido. Sem I/O — testadas em director.test.ts.
 */
import { MAX_QUANTITY } from '../limits';

export type DirectorMode = 'viral' | 'ideia';
export const MODE_LABELS: Record<DirectorMode, string> = {
  viral: '🎬 A partir de um viral',
  ideia: '✨ A partir da sua ideia',
};
export const MODE_EMOJI: Record<DirectorMode, string> = { viral: '🎬', ideia: '✨' };

const WORDS: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, 'três': 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
};
const NUM = '(\\d{1,3}|um|uma|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez)';

/**
 * Quantidade de vídeos pedida em texto livre: "3 vídeos", "faz 20", "gera dois vídeos de cada".
 * Devolve null se não achar; limita a 1..MAX_QUANTITY.
 */
export function parseQuantity(text: string): number | null {
  const t = String(text ?? '').toLowerCase();
  const patterns = [
    new RegExp(`\\b${NUM}\\s+v[ií]deos?\\b`),
    new RegExp(`\\bfaz(?:er)?\\s+${NUM}\\b`),
    new RegExp(`\\b(?:gera|gerar|monta|montar|quero)\\s+${NUM}\\b(?!\\s*(?:segundos|cenas|s\\b))`),
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (!m) continue;
    const raw = m[1];
    const n = /^\d+$/.test(raw) ? parseInt(raw, 10) : WORDS[raw];
    if (!n || n < 1) continue;
    return Math.min(n, MAX_QUANTITY);
  }
  return null;
}

export interface TitleSource {
  role: 'aluna' | 'diretor' | 'sistema';
  text: string;
  attachments?: { nome: string }[];
}

const TITLE_MAX = 48;

/** Título automático: primeira fala da aluna (sem prefixo "[...]"), até 48 caracteres. */
export function conversationTitle(messages: TitleSource[]): string {
  const first = messages.find((m) => m.role === 'aluna' && (m.text || '').trim());
  if (!first) {
    const att = messages.flatMap((m) => m.attachments ?? [])[0];
    return att ? `Referência: ${att.nome}`.slice(0, TITLE_MAX) : 'Nova conversa';
  }
  const t = first.text.replace(/^\[[^\]]{1,80}\]\s*/, '').replace(/\s+/g, ' ').trim();
  if (!t) return 'Nova conversa';
  if (t.length <= TITLE_MAX) return t.charAt(0).toUpperCase() + t.slice(1);
  const cut = t.slice(0, TITLE_MAX - 1);
  const space = cut.lastIndexOf(' ');
  const base = space > 20 ? cut.slice(0, space) : cut;
  return (base.charAt(0).toUpperCase() + base.slice(1)).trimEnd() + '…';
}

export const COMPOSER_PLACEHOLDER = {
  ideia: 'Descreva o vídeo que você quer…',
  comViral: 'O que você quer fazer com esse viral?',
  semViral: 'Conte a sua ideia ou arraste o viral acima. Pode anexar imagem/vídeo de referência no 📎 (Enter envia)',
} as const;

export function composerPlaceholder(mode: DirectorMode, hasViral: boolean): string {
  if (mode === 'ideia') return COMPOSER_PLACEHOLDER.ideia;
  return hasViral ? COMPOSER_PLACEHOLDER.comViral : COMPOSER_PLACEHOLDER.semViral;
}

/** "11:31" — hora local pt-BR na lista de conversas. */
export function formatHour(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}
