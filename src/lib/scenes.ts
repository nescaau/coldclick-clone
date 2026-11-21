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

export function splitScenes(units: SceneUnit[], maxSpeech: number = MAX_SCENE_SPEECH_SEC): Scene[] {
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
