import { describe, expect, it } from 'vitest';
import { manualFaltas } from './manual-falta';
import { imageModelNote } from './settings';

describe('"Falta:" da aba Manual (literais do original)', () => {
  const lido = { state: 'analisado' };
  it('ordem palavra → viral → marcados', () => {
    expect(manualFaltas({ palavra: '', viral: null, novos: false, marcados: 0 })).toEqual([
      'Qual palavra o público vai comentar?',
      'suba um viral e espere a leitura (passo 1)',
      'marque quem aparece (passo 3) — só os marcados entram no vídeo',
    ]);
    expect(manualFaltas({ palavra: 'x', viral: null, novos: false, marcados: 0 })[0]).toBe('suba um viral e espere a leitura (passo 1)');
    expect(manualFaltas({ palavra: 'x', viral: lido, novos: false, marcados: 0 })).toEqual(['marque quem aparece (passo 3) — só os marcados entram no vídeo']);
  });
  it('viral não lido', () => {
    expect(manualFaltas({ palavra: 'x', viral: { state: 'preparando' }, novos: true, marcados: 0 })).toEqual(['o viral escolhido não foi lido — clique em "tentar ler de novo"']);
  });
  it('nada falta', () => {
    expect(manualFaltas({ palavra: 'x', viral: lido, novos: false, marcados: 1 })).toEqual([]);
  });
});

describe('nota da Imagem em ⚙', () => {
  it('3 variantes', () => {
    expect(imageModelNote('Nano Banana Pro')).toBe('Melhor rosto.');
    expect(imageModelNote('Nano Banana 2')).toBe('Equilíbrio entre rosto e velocidade.');
    expect(imageModelNote('Nano Banana 2 Lite')).toBe('Mais rápido.');
  });
});
