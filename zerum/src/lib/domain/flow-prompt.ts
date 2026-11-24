/**
 * Prompt de UMA cena para o Flow (geração real). Regras puras, sem I/O.
 *
 * O Flow (Veo) trabalha melhor com instruções em inglês; a FALA da cena entra no idioma escolhido no lote, entre aspas.
 * O que não pode acontecer: gastar crédito sem ter o que falar. Placeholder do roteiro ("Cena 2: mesma fala do viral…")
 * NÃO é fala — nesse caso o prompt usa as observações do pedido como assunto, e sem nem isso a cena é recusada
 * ANTES de qualquer envio (`ok:false`), com a explicação do que o usuário precisa preencher.
 */
import type { Gender } from './avatar';
import type { ViralAnalysis } from './analysis';
import type { PathId, VariationId } from './plan';
import { languageName, type LanguageId } from './video-options';

/** Tamanho máximo do prompt enviado (a extensão aceita até 3000; ficamos bem abaixo). */
export const MAX_PROMPT_CHARS = 1200;

// ─── roteiro "de mentira" que o clone escreve quando não há o que falar (precisa ser reconhecível) ───────────────────
export type PlaceholderKind = 'adaptar' | 'vazio';
export const placeholderScript = (kind: PlaceholderKind, k: number): string =>
  kind === 'adaptar'
    ? `Cena ${k}: fala nova sobre o mesmo assunto (o roteiro é escrito pela IA do Diretor — fase futura).`
    : `Cena ${k}: mesma fala do viral (a transcrição está vazia — preencha em “A leitura errou? Corrigir”).`;

/** O texto é o placeholder (não uma fala de verdade)? Também vale para o "Cena N" curto dos lotes migrados da v1. */
export const isPlaceholderScript = (text: string): boolean => /^\s*Cena \d+(?::\s*(fala nova sobre o mesmo assunto|mesma fala do viral)|\s*$)/.test(text) || !text.trim();

const LANG_EN: Record<LanguageId, string> = { en: 'English', de: 'German', es: 'Spanish' };

const VARIATION_HINT: Partial<Record<VariationId, string>> = {
  roleta: 'Pick a fresh outfit, room and prop for this video.',
  gesto: 'Vary small hand gestures and props slightly.',
  combinada: 'Vary gestures, props and setting slightly.',
  novo: 'Create something entirely new that reuses only the structure of the reference video.',
};

export interface PromptAvatar {
  name: string;
  description: string;
  gender: Gender;
  /** Há foto: ela vai como imagem de partida e o prompt pede "a mesma pessoa". */
  hasPhoto: boolean;
}

export interface PromptInput {
  language: LanguageId;
  sceneIdx: number;
  sceneCount: number;
  /** Fala (roteiro) desta cena, como guardada no vídeo. */
  fala: string;
  path: PathId;
  variation: VariationId;
  avatar: PromptAvatar | null;
  analysis: Pick<ViralAnalysis, 'tela' | 'acoes' | 'enquadramento'> | null;
  /** Observações do pedido ("lei pros roteiros e pras cenas"). */
  notes: string;
}

export type PromptResult = { ok: true; prompt: string } | { ok: false; error: string };

const one = (s: string, max: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
};
/** Aspas dentro da fala não podem quebrar o prompt. */
const quote = (s: string) => `"${one(s, 420).replace(/"/g, '”')}"`;

export function buildScenePrompt(i: PromptInput): PromptResult {
  const lang = LANG_EN[i.language] ?? languageName(i.language);
  const k = i.sceneIdx + 1;
  const speech = isPlaceholderScript(i.fala) ? '' : one(i.fala, 420);
  const topic = one(i.notes, 240);
  if (!speech && !topic) {
    return {
      ok: false,
      error: `A cena ${k} não tem o que falar: a transcrição do viral está vazia (ou o roteiro é do Diretor com IA, que ainda não existe). Preencha a fala em “A leitura errou? Corrigir” ou escreva o assunto nas observações — nenhum crédito foi gasto.`,
    };
  }

  const lines: string[] = [];
  const head = 'Vertical 9:16 smartphone video, 8 seconds, realistic, natural lighting. No subtitles, no captions, no text overlays, no watermark.';

  const a = i.avatar;
  const who = a?.hasPhoto
    ? 'The person is the same one as in the reference image: keep the exact face, hair and outfit.'
    : a?.description.trim()
      ? `The person: ${one(a.description, 220)}${a.gender === 'mulher' ? ' (a woman)' : a.gender === 'homem' ? ' (a man)' : ''}.`
      : a?.gender === 'mulher'
        ? 'The person is a woman.'
        : a?.gender === 'homem'
          ? 'The person is a man.'
          : 'A single person facing the camera.';
  lines.push(who);

  const talk = speech
    ? `The person says, in ${lang}, exactly: ${quote(speech)} Natural lip sync, speaking straight to the camera.`
    : `The person speaks naturally to the camera in ${lang}, one or two short sentences, about: ${topic}.`;
  lines.push(talk);

  const tela = i.analysis?.tela ? one(i.analysis.tela, 220) : '';
  const frame = i.analysis?.enquadramento ? one(i.analysis.enquadramento, 80) : '';
  const acoes = i.analysis?.acoes ? one(i.analysis.acoes, 300) : '';
  const hint = VARIATION_HINT[i.variation] ?? '';
  const extra = speech && topic ? `Extra instructions: ${topic}` : '';

  // Do mais importante ao menos importante: se passar do limite, cortam-se as últimas linhas.
  const optional = [
    i.path === 'igual' || i.path === 'adaptar' ? (tela || frame ? `Setting and camera: ${[tela, frame && `framing ${frame}`].filter(Boolean).join('; ')}.` : '') : '',
    extra,
    hint,
    acoes ? `What happens across the whole video (this clip is scene ${k} of ${i.sceneCount}): ${acoes}` : i.sceneCount > 1 ? `This clip is scene ${k} of ${i.sceneCount}.` : '',
  ].filter(Boolean);

  let prompt = [head, ...lines, ...optional].join('\n');
  while (prompt.length > MAX_PROMPT_CHARS && optional.length) {
    optional.pop();
    prompt = [head, ...lines, ...optional].join('\n');
  }
  if (prompt.length > MAX_PROMPT_CHARS) prompt = prompt.slice(0, MAX_PROMPT_CHARS - 1).trimEnd() + '…';
  return { ok: true, prompt };
}
