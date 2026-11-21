import { describe, expect, it } from 'vitest';
import { estimateUnitsFromText, MAX_SCENE_SPEECH_SEC, speechSeconds, splitScenes, wordsToUnits, type TimedWord } from './scenes';

/** Gera palavras com tempos uniformes a partir de um texto. */
function words(text: string, start: number, perWord: number): TimedWord[] {
  return text.split(' ').map((w, i) => ({ word: w, start: start + i * perWord, end: start + (i + 1) * perWord }));
}

describe('splitScenes', () => {
  it('reproduz o exemplo da referência: 2 cenas, a 1ª com fala de 5,1 s', () => {
    const w = [
      ...words('Wait a sec!', 0.1, 0.3),
      ...words('Before you scroll away, we have a whole year of unlimited data for just ten euro a month.', 1.0, 0.24).map((x, i, a) =>
        i === a.length - 1 ? { ...x, end: 5.2 } : x,
      ),
      ...words('Head to cleanmobile.ie now!', 5.6, 0.45).map((x, i, a) => (i === a.length - 1 ? { ...x, end: 7.4 } : x)),
    ];
    const scenes = splitScenes(wordsToUnits(w));
    expect(scenes).toHaveLength(2);
    expect(scenes[0].start).toBe(0.1);
    expect(scenes[0].end).toBe(5.2);
    expect(speechSeconds(scenes[0])).toBe(5.1);
    expect(scenes[0].text.startsWith('Wait a sec! Before you scroll away')).toBe(true);
    expect(scenes[1].text).toBe('Head to cleanmobile.ie now!');
    expect(scenes[1].start).toBe(5.6);
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
