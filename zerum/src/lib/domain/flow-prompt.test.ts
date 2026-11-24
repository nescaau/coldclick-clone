/** Prompt de cada cena (geração real) e o roteiro "de mentira" do clone. */
import { describe, expect, it } from 'vitest';
import { MAX_PROMPT_CHARS, buildScenePrompt, isPlaceholderScript, placeholderScript, type PromptInput } from './flow-prompt';

const base = (o: Partial<PromptInput> = {}): PromptInput => ({
  language: 'en',
  sceneIdx: 1,
  sceneCount: 4,
  fala: 'I tried this for a week and look at my skin now.',
  path: 'igual',
  variation: 'sem',
  avatar: null,
  analysis: null,
  notes: '',
  ...o,
});
const ok = (i: PromptInput) => {
  const r = buildScenePrompt(i);
  if (!r.ok) throw new Error(r.error);
  return r.prompt;
};

describe('placeholder do roteiro', () => {
  it('o texto que o clone escreve quando não há fala é reconhecido como "não é fala"', () => {
    expect(isPlaceholderScript(placeholderScript('vazio', 3))).toBe(true);
    expect(isPlaceholderScript(placeholderScript('adaptar', 1))).toBe(true);
    expect(isPlaceholderScript('Cena 2')).toBe(true); // lote migrado da v1
    expect(isPlaceholderScript('   ')).toBe(true);
    expect(isPlaceholderScript('Cena 5: hello there')).toBe(false); // fala de verdade que começa com "Cena N:"
    expect(isPlaceholderScript('I love this product.')).toBe(false);
  });
});

describe('buildScenePrompt', () => {
  it('formato vertical 9:16, 8 s, sem legenda/texto na tela; a fala entra entre aspas, no idioma pedido', () => {
    const p = ok(base());
    expect(p).toMatch(/Vertical 9:16/);
    expect(p).toMatch(/8 seconds/);
    expect(p).toMatch(/No subtitles, no captions, no text overlays, no watermark/);
    expect(p).toContain('The person says, in English, exactly: "I tried this for a week and look at my skin now."');
    expect(ok(base({ language: 'de' }))).toMatch(/in German/);
    expect(ok(base({ language: 'es' }))).toMatch(/in Spanish/);
  });

  it('avatar com foto → "a mesma pessoa da imagem de referência"; sem foto → a descrição e o sexo', () => {
    expect(ok(base({ avatar: { name: 'Ana', description: '', gender: 'mulher', hasPhoto: true } }))).toMatch(/same one as in the reference image/);
    const sem = ok(base({ avatar: { name: 'Ana', description: 'enfermeira de 60 anos, cabelo grisalho', gender: 'mulher', hasPhoto: false } }));
    expect(sem).toMatch(/The person: enfermeira de 60 anos, cabelo grisalho \(a woman\)/);
    expect(ok(base({ avatar: { name: 'Beto', description: '', gender: 'homem', hasPhoto: false } }))).toMatch(/The person is a man/);
    expect(ok(base())).toMatch(/A single person facing the camera/);
  });

  it('usa o que o viral analisado diz (lugar, enquadramento, ações) e situa a cena no vídeo', () => {
    const p = ok(base({ analysis: { tela: 'cozinha clara com bancada de mármore', acoes: 'ela mostra o frasco e aplica no rosto', enquadramento: 'vertical 1080×1920' } }));
    expect(p).toMatch(/Setting and camera: cozinha clara com bancada de mármore; framing vertical 1080×1920/);
    expect(p).toMatch(/scene 2 of 4/);
    expect(p).toMatch(/ela mostra o frasco/);
  });

  it('sem fala de verdade: usa as observações como assunto; sem nem isso a cena é RECUSADA antes de gastar crédito', () => {
    const empty = placeholderScript('vazio', 2);
    const withNotes = ok(base({ fala: empty, notes: 'falar do creme noturno com colágeno' }));
    expect(withNotes).toMatch(/speaks naturally to the camera in English, one or two short sentences, about: falar do creme noturno/);
    expect(withNotes).not.toMatch(/Cena 2/); // o placeholder nunca vai para o Flow
    const r = buildScenePrompt(base({ fala: empty, notes: '' }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/A cena 2 não tem o que falar/);
      expect(r.error).toMatch(/nenhum crédito foi gasto/);
    }
  });

  it('fala + observações: as observações viram instrução extra (a fala segue literal)', () => {
    expect(ok(base({ notes: 'sem mostrar a marca' }))).toMatch(/Extra instructions: sem mostrar a marca/);
  });

  it('variações do lote viram dica curta; "sem variação" não acrescenta nada', () => {
    expect(ok(base({ variation: 'roleta' }))).toMatch(/fresh outfit, room and prop/);
    expect(ok(base({ variation: 'gesto' }))).toMatch(/small hand gestures/);
    expect(ok(base({ variation: 'sem' }))).not.toMatch(/outfit|gestures/);
  });

  it('aspas dentro da fala não quebram o prompt; fala enorme é cortada', () => {
    expect(ok(base({ fala: 'He said "wow" and left.' }))).toContain('He said ”wow” and left.');
    const long = ok(base({ fala: 'palavra '.repeat(200) }));
    expect(long).toContain('…');
  });

  it('o prompt nunca passa do limite (corta o que é menos importante primeiro; a fala fica)', () => {
    const p = ok(
      base({
        analysis: { tela: 'x'.repeat(500), acoes: 'y'.repeat(900), enquadramento: 'vertical' },
        notes: 'n'.repeat(300),
        variation: 'combinada',
        avatar: { name: 'A', description: 'd'.repeat(500), gender: 'mulher', hasPhoto: false },
      }),
    );
    expect(p.length).toBeLessThanOrEqual(MAX_PROMPT_CHARS);
    expect(p).toContain('exactly: "I tried this for a week');
  });
});
