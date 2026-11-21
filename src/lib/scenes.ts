/**
 * Divisão da fala transcrita em CENAS — lógica pura (sem I/O), testada em scenes.test.ts.
 *
 * Regra (plataforma de referência): "cada fala fica abaixo de 8 segundos e reserva o fim do clipe
 * para o corte". Cada cena vira um clipe de até CLIP_SEC; a fala em si ocupa no máximo
 * MAX_SCENE_SPEECH_SEC, deixando folga no fim do clipe.
 *
 * Estratégia: agrupa frases inteiras de forma gulosa; uma frase maior que o limite é quebrada
 * por palavras.
 */

export const CLIP_SEC = 8;
/** Duração máxima da fala em uma cena (reserva ≥ 1 s no fim do clipe para o corte). */
export const MAX_SCENE_SPEECH_SEC = 7;

export interface SceneUnit {
  text: string;
  start: number;
  end: number;
  /** A unidade fecha uma frase (pontuação final ou fim de segmento). */
  sentenceEnd: boolean;
}

export interface Scene {
  index: number;
  start: number;
  end: number;
  text: string;
}

export interface TimedWord {
  word: string;
  start: number;
  end: number;
}

export interface TimedSegment {
  text: string;
  start: number;
  end: number;
}

const SENTENCE_END = /[.!?…]["'”’)\]]*$/;
const round1 = (n: number) => Math.round(n * 10) / 10;

export function wordsToUnits(words: TimedWord[]): SceneUnit[] {
  return words
    .map((w) => ({ text: w.word.trim(), start: w.start, end: w.end, sentenceEnd: SENTENCE_END.test(w.word.trim()) }))
    .filter((u) => u.text.length > 0);
}

/**
 * A API de transcrição devolve palavras SEM pontuação ("Wait", "a", "sec") e segmentos COM ela
 * ("Wait a sec!"). Para não perder a pontuação da copy (nem os fins de frase), alinha cada segmento às
 * palavras que ele cobre (por contagem de tokens quando os totais batem; senão, pelo ponto médio do tempo):
 *  - mesma quantidade de tokens → a palavra ganha o texto do token (com pontuação) e o fim de frase vem
 *    do próprio token;
 *  - quantidade diferente (hifens, números por extenso…) → mantém as palavras e marca só a ÚLTIMA como
 *    fim de frase se o segmento termina em pontuação.
 * Palavras fora de qualquer segmento são mantidas como estão.
 */
export function alignWordsToSegments(words: TimedWord[], segments: TimedSegment[]): SceneUnit[] {
  const clean = words
    .map((w) => ({ text: w.word.trim(), start: w.start, end: w.end }))
    .filter((w) => w.text.length > 0);
  if (segments.length === 0) return wordsToUnits(words);

  const units: SceneUnit[] = [];
  let i = 0;
  const mid = (w: { start: number; end: number }) => (w.start + w.end) / 2;
  const sorted = [...segments].sort((x, y) => x.start - y.start);
  const tokenized = sorted.map((seg) => ({ seg, text: seg.text.trim(), tokens: seg.text.trim().split(/\s+/).filter(Boolean) }));
  // Caso comum: o nº total de tokens dos segmentos == nº de palavras → alinha SEQUENCIALMENTE, por contagem
  // (robusto a palavras cujo tempo passa um pouco do fim do segmento). Senão, cai para o alinhamento por tempo.
  const byCount = tokenized.reduce((n, t) => n + t.tokens.length, 0) === clean.length;

  for (const { seg, text: segText, tokens } of tokenized) {
    const mine: typeof clean = [];
    if (byCount) for (let k = 0; k < tokens.length; k++) mine.push(clean[i++]);
    else while (i < clean.length && mid(clean[i]) < seg.end) mine.push(clean[i++]);
    if (mine.length === 0) continue;

    const aligned = tokens.length === mine.length;
    mine.forEach((w, k) => {
      const text = aligned ? tokens[k] : w.text;
      const last = k === mine.length - 1;
      units.push({ text, start: w.start, end: w.end, sentenceEnd: SENTENCE_END.test(text) || (last && SENTENCE_END.test(segText)) });
    });
  }
  for (; i < clean.length; i++) {
    const w = clean[i];
    units.push({ text: w.text, start: w.start, end: w.end, sentenceEnd: SENTENCE_END.test(w.text) });
  }
  return units;
}

/** Quando só há segmentos (sem tempos por palavra), cada segmento é tratado como uma frase. */
export function segmentsToUnits(segments: TimedSegment[]): SceneUnit[] {
  return segments
    .map((s) => ({ text: s.text.trim(), start: s.start, end: s.end, sentenceEnd: true }))
    .filter((u) => u.text.length > 0);
}

/** Agrupa unidades em frases. */
function toSentences(units: SceneUnit[]): SceneUnit[][] {
  const sentences: SceneUnit[][] = [];
  let current: SceneUnit[] = [];
  for (const u of units) {
    current.push(u);
    if (u.sentenceEnd) {
      sentences.push(current);
      current = [];
    }
  }
  if (current.length) sentences.push(current);
  return sentences;
}

const span = (units: SceneUnit[]) => units[units.length - 1].end - units[0].start;
const join = (units: SceneUnit[]) => units.map((u) => u.text).join(' ');

/**
 * Quebra uma unidade longa demais (um segmento inteiro, uma frase estimada pelo texto…) em pedaços de até
 * `maxSpeech`, repartindo o tempo proporcionalmente ao nº de caracteres. Só o último pedaço herda o fim de
 * frase. Uma palavra isolada maior que o limite não pode ser quebrada: o fim dela é limitado ao máximo.
 */
export function subdivideUnit(u: SceneUnit, maxSpeech: number = MAX_SCENE_SPEECH_SEC): SceneUnit[] {
  const dur = u.end - u.start;
  if (dur <= maxSpeech) return [u];
  const tokens = u.text.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return [{ ...u, end: u.start + maxSpeech }];

  const perChar = dur / (tokens.reduce((n, t) => n + t.length + 1, 0) || 1);
  const chunks: string[][] = [[]];
  let chunkChars = 0;
  for (const t of tokens) {
    if (chunks[chunks.length - 1].length && (chunkChars + t.length + 1) * perChar > maxSpeech) {
      chunks.push([]);
      chunkChars = 0;
    }
    chunks[chunks.length - 1].push(t);
    chunkChars += t.length + 1;
  }

  let offset = u.start;
  return chunks.map((c, k) => {
    const chars = c.reduce((n, t) => n + t.length + 1, 0);
    const start = offset;
    const end = Math.min(start + chars * perChar, start + maxSpeech);
    offset = start + chars * perChar;
    return { text: c.join(' '), start, end, sentenceEnd: k === chunks.length - 1 ? u.sentenceEnd : false };
  });
}

export function splitScenes(rawUnits: SceneUnit[], maxSpeech: number = MAX_SCENE_SPEECH_SEC): Scene[] {
  // Garantia: nenhuma unidade individual passa do limite (assim nenhuma cena passa de maxSpeech < 8 s).
  const units = rawUnits.flatMap((u) => subdivideUnit(u, maxSpeech));
  const groups: SceneUnit[][] = [];
  let current: SceneUnit[] = [];

  const flush = () => {
    if (current.length) groups.push(current);
    current = [];
  };

  for (const sentence of toSentences(units)) {
    if (current.length && span([...current, ...sentence]) <= maxSpeech) {
      current.push(...sentence);
      continue;
    }
    flush();
    if (span(sentence) <= maxSpeech) {
      current = [...sentence];
      continue;
    }
    // Frase maior que o limite: quebra por palavras.
    for (const u of sentence) {
      if (current.length && span([...current, u]) > maxSpeech) flush();
      current.push(u);
    }
  }
  flush();

  return groups.map((g, i) => ({
    index: i + 1,
    start: round1(g[0].start),
    end: round1(g[g.length - 1].end),
    text: join(g),
  }));
}

/** Copy do vídeo: com cenas, é o texto delas (uma por parágrafo); sem cenas, o texto escrito à mão. */
export const deriveCopyText = (scenes: ReadonlyArray<Pick<Scene, 'text'>>, manual: string): string =>
  scenes.length ? scenes.map((s) => s.text.trim()).join('\n\n') : manual.trim();

/** Duração da fala de uma cena, em segundos (1 casa decimal). */
export const speechSeconds = (s: Pick<Scene, 'start' | 'end'>): number => round1(s.end - s.start);

/**
 * Plano B quando o serviço de transcrição não devolve tempos: estima a duração pela quantidade
 * de caracteres (~15 caracteres de fala por segundo) para ainda assim propor cenas.
 */
export function estimateUnitsFromText(text: string, charsPerSec = 15): SceneUnit[] {
  const sentences = text.match(/[^.!?…]+[.!?…]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
  let t = 0;
  return sentences.map((s) => {
    const dur = Math.max(0.5, s.length / charsPerSec);
    const unit = { text: s, start: round1(t), end: round1(t + dur), sentenceEnd: true };
    t += dur + 0.2;
    return unit;
  });
}
