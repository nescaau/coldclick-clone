import { describe, expect, it } from 'vitest';
import {
  alignWordsToSegments,
  CLIP_SEC,
  estimateUnitsFromText,
  MAX_SCENE_SPEECH_SEC,
  segmentsToUnits,
  speechSeconds,
  splitScenes,
  subdivideUnit,
  wordsToUnits,
  type TimedSegment,
  type TimedWord,
} from './scenes';

/** Gera palavras com tempos uniformes a partir de um texto. */
function words(text: string, start: number, perWord: number): TimedWord[] {
  return text.split(' ').map((w, i) => ({ word: w, start: start + i * perWord, end: start + (i + 1) * perWord }));
}

describe('splitScenes', () => {
  it('reproduz o exemplo da referência com a resposta REAL da API (palavras sem pontuação): 2 cenas, a 1ª com fala de 5,1 s', () => {
    const w = [
      ...words('Wait a sec', 0.1, 0.3),
      ...words('Before you scroll away we have a whole year of unlimited data for just ten euro a month', 1.0, 0.24).map((x, i, a) =>
        i === a.length - 1 ? { ...x, end: 5.2 } : x,
      ),
      ...words('Head to cleanmobile.ie now', 5.6, 0.45).map((x, i, a) => (i === a.length - 1 ? { ...x, end: 7.4 } : x)),
    ];
    const segments: TimedSegment[] = [
      { text: ' Wait a sec!', start: 0.1, end: 1.0 },
      { text: ' Before you scroll away, we have a whole year of unlimited data for just ten euro a month.', start: 1.0, end: 5.2 },
      { text: ' Head to cleanmobile.ie now!', start: 5.6, end: 7.4 },
    ];
    const scenes = splitScenes(alignWordsToSegments(w, segments));
    expect(scenes).toHaveLength(2);
    expect(scenes[0].start).toBe(0.1);
    expect(scenes[0].end).toBe(5.2);
    expect(speechSeconds(scenes[0])).toBe(5.1);
    // A pontuação da copy sobrevive (antes se perdia porque a API não a devolve nas palavras).
    expect(scenes[0].text).toBe('Wait a sec! Before you scroll away, we have a whole year of unlimited data for just ten euro a month.');
    expect(scenes[1].text).toBe('Head to cleanmobile.ie now!');
    expect(scenes[1].start).toBe(5.6);
  });

  it('palavras COM pontuação (outros servidores) continuam funcionando', () => {
    const scenes = splitScenes(wordsToUnits([...words('Oi.', 0, 0.5), ...words('Tudo bem?', 0.6, 0.4)]));
    expect(scenes).toHaveLength(1);
    expect(scenes[0].text).toBe('Oi. Tudo bem?');
  });

  it('nunca passa do limite de fala por cena e reserva o fim do clipe', () => {
    const w = words('um dois tres quatro cinco seis sete oito nove dez onze doze treze quatorze quinze', 0, 1);
    const scenes = splitScenes(wordsToUnits(w));
    expect(scenes.length).toBeGreaterThan(1);
    for (const s of scenes) expect(speechSeconds(s)).toBeLessThanOrEqual(MAX_SCENE_SPEECH_SEC);
    expect(scenes.map((s) => s.index)).toEqual(scenes.map((_, i) => i + 1));
  });

  it('junta frases curtas em uma única cena', () => {
    const w = [...words('Oi.', 0, 0.5), ...words('Tudo bem?', 0.6, 0.4), ...words('Vamos lá.', 1.5, 0.4)];
    expect(splitScenes(wordsToUnits(w))).toHaveLength(1);
  });

  it('retorna lista vazia sem fala', () => {
    expect(splitScenes([])).toEqual([]);
  });

  it('estima tempos a partir do texto quando o serviço não devolve timestamps', () => {
    const units = estimateUnitsFromText('Primeira frase aqui. Segunda frase também! Terceira?');
    expect(units).toHaveLength(3);
    expect(units[1].start).toBeGreaterThan(units[0].end);
    expect(splitScenes(units).length).toBeGreaterThanOrEqual(1);
  });
});

/** Formato REAL da API: palavras sem pontuação + segmentos com pontuação. */
describe('alinhamento palavras ↔ segmentos (resposta real: palavras sem pontuação)', () => {
  const raw = (text: string, start: number, per: number): TimedWord[] =>
    text.split(' ').map((w, i) => ({ word: w, start: start + i * per, end: start + (i + 1) * per }));

  it('recupera a pontuação da copy e detecta fins de frase pelos segmentos', () => {
    const w = [...raw('Wait a sec', 0, 0.4), ...raw('Before you scroll away', 1.4, 0.4)];
    const segs: TimedSegment[] = [
      { text: ' Wait a sec!', start: 0, end: 1.2 },
      { text: ' Before you scroll away.', start: 1.4, end: 3.4 },
    ];
    const units = alignWordsToSegments(w, segs);
    expect(units.map((u) => u.text)).toEqual(['Wait', 'a', 'sec!', 'Before', 'you', 'scroll', 'away.']);
    expect(units.filter((u) => u.sentenceEnd).map((u) => u.text)).toEqual(['sec!', 'away.']);
    const scenes = splitScenes(units);
    expect(scenes).toHaveLength(1);
    expect(scenes[0].text).toBe('Wait a sec! Before you scroll away.');
  });

  it('com contagem de tokens diferente mantém as palavras e marca o fim pelo segmento', () => {
    const w = raw('guarda chuva azul', 0, 0.5);
    const units = alignWordsToSegments(w, [{ text: 'guarda-chuva azul.', start: 0, end: 1.5 }]);
    expect(units.map((u) => u.text).join(' ')).toBe('guarda chuva azul');
    expect(units[units.length - 1].sentenceEnd).toBe(true);
    expect(units[0].sentenceEnd).toBe(false);
  });

  it('sem pontuação nenhuma, quebra por tempo e ainda respeita o limite', () => {
    const w = raw('um dois tres quatro cinco seis sete oito nove dez onze doze treze quatorze quinze', 0, 1);
    for (const sc of splitScenes(alignWordsToSegments(w, []))) expect(speechSeconds(sc)).toBeLessThanOrEqual(MAX_SCENE_SPEECH_SEC);
  });

  it('palavras cujo tempo passa do fim do segmento (caso real) continuam alinhadas por contagem', () => {
    // a última palavra termina em 5,32 s, mas o segmento diz que acaba em 5,2 s
    const w = [...raw('Wait a sec', 0.1, 0.3), ...raw('Before you scroll away we have a whole year of unlimited data for just ten euro a month', 1.0, 0.24), ...raw('Head to cleanmobile.ie now', 5.6, 0.45)];
    const segs: TimedSegment[] = [
      { text: ' Wait a sec!', start: 0.1, end: 1.0 },
      { text: ' Before you scroll away, we have a whole year of unlimited data for just ten euro a month.', start: 1.0, end: 5.2 },
      { text: ' Head to cleanmobile.ie now!', start: 5.6, end: 7.4 },
    ];
    const scenes = splitScenes(alignWordsToSegments(w, segs));
    expect(scenes).toHaveLength(2);
    expect(scenes[0].text).toBe('Wait a sec! Before you scroll away, we have a whole year of unlimited data for just ten euro a month.');
    expect(scenes[1].text).toBe('Head to cleanmobile.ie now!');
  });

  it('mantém palavras sem segmento correspondente', () => {
    const units = alignWordsToSegments(raw('a b c', 0, 1), [{ text: 'a b.', start: 0, end: 2 }]);
    expect(units.map((u) => u.text)).toEqual(['a', 'b.', 'c']);
  });
});

describe('cenas nunca passam do limite (unidades longas demais)', () => {
  it('subdivide um segmento de 20 s em pedaços ≤ limite, sem perder texto', () => {
    const text = Array.from({ length: 40 }, (_, i) => `palavra${i}`).join(' ');
    const scenes = splitScenes(segmentsToUnits([{ text, start: 0, end: 20 }]));
    expect(scenes.length).toBeGreaterThanOrEqual(3);
    for (const s of scenes) {
      expect(s.end - s.start).toBeLessThanOrEqual(MAX_SCENE_SPEECH_SEC + 0.05);
      expect(s.end - s.start).toBeLessThan(CLIP_SEC);
    }
    expect(scenes.map((s) => s.text).join(' ')).toBe(text);
  });

  it('frase estimada pelo texto com 400 caracteres também é subdividida', () => {
    const long = `${'blá '.repeat(100).trim()}.`;
    const scenes = splitScenes(estimateUnitsFromText(long));
    expect(scenes.length).toBeGreaterThan(1);
    for (const s of scenes) expect(s.end - s.start).toBeLessThanOrEqual(MAX_SCENE_SPEECH_SEC + 0.05);
  });

  it('o fim de frase só fica no último pedaço', () => {
    const pieces = subdivideUnit({ text: 'a b c d e f g h i j', start: 0, end: 20, sentenceEnd: true }, 7);
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.slice(0, -1).every((p) => !p.sentenceEnd)).toBe(true);
    expect(pieces[pieces.length - 1].sentenceEnd).toBe(true);
  });

  it('uma palavra isolada gigante tem o fim limitado (não dá para quebrá-la)', () => {
    const [only] = splitScenes([{ text: 'aaaa', start: 0, end: 30, sentenceEnd: true }]);
    expect(only.end - only.start).toBeLessThanOrEqual(MAX_SCENE_SPEECH_SEC);
  });
});

