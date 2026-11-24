import { describe, expect, it } from 'vitest';
import { buildSteps, executeLabel, interpretRequest, pedidoSummary, type PlanParams } from './plan';

const base: PlanParams = { mode: 'viral', viralId: 'v', quantity: 1, path: 'igual', variation: 'sem', avatarIds: [], newAvatars: 0, language: 'en', word: '', batchName: '', bubbleOn: true, bubbleColor: '#FFC400', notes: '' };

describe('interpretRequest (Diretor local, sem IA)', () => {
  it('quantidade, caminho, variação e idioma por palavras-chave', () => {
    const { params, entendi } = interpretRequest('quero esse vídeo adaptado, 3 vídeos, método roleta, em espanhol', base);
    expect(params).toMatchObject({ quantity: 3, path: 'adaptar', variation: 'roleta', language: 'es' });
    expect(entendi).toEqual(['3 vídeos', 'Adaptar (falas novas)', 'Método roleta', 'Espanhol']);
  });

  it('"avatares novos" acompanha a quantidade (um rosto novo por vídeo) e zera os marcados', () => {
    const r = interpretRequest('faz 4 com pessoas novas', { ...base, avatarIds: ['a'] });
    expect(r.params).toMatchObject({ quantity: 4, newAvatars: 4, avatarIds: [] });
    expect(interpretRequest('faz 6', r.params).params.newAvatars).toBe(6); // refinar a quantidade mantém um rosto por vídeo
  });

  it('palavra do comentário', () => {
    expect(interpretRequest('palavra UMBIGO', base).params.word).toBe('UMBIGO');
    expect(interpretRequest('a palavra é muito boa', base).params.word).toBe('');
  });

  it('refinar: parte dos parâmetros atuais e acumula as observações ("lei pros roteiros")', () => {
    const a = interpretRequest('quero igual, 3 vídeos', base);
    const b = interpretRequest('troca a abertura', a.params);
    expect(b.params.quantity).toBe(3);
    expect(b.params.notes).toBe('quero igual, 3 vídeos\ntroca a abertura');
    expect(b.entendi).toEqual([]);
  });

  it('limita ao teto de vídeos', () => {
    expect(interpretRequest('faz 999', base).params.quantity).toBe(50);
  });
});

describe('buildSteps / rótulos', () => {
  it('passos numerados; criar avatares novos e gerar gastam crédito, o resto não', () => {
    const steps = buildSteps({ ...base, quantity: 2, newAvatars: 2 }, { viralName: 'REF', avatarNames: [], batchTitle: 'Lote' });
    expect(steps.map((s) => s.id)).toEqual([1, 2, 3, 4, 5]);
    expect(steps.filter((s) => s.gastaCredito).map((s) => s.texto)).toEqual(['Criar 2 avatares novos (um rosto por vídeo)', 'Gerar 2 vídeos e abrir a Produção']);
    expect(steps[0].texto).toContain('REF');
  });

  it('sem viral (ideia) o primeiro passo não fala de viral', () => {
    const steps = buildSteps({ ...base, mode: 'ideia', viralId: null }, { viralName: null, avatarNames: ['Ana'], batchTitle: 'Lote' });
    expect(steps[0].texto).toBe('Usar o avatar Ana');
  });

  it('rótulo do botão: Executar / Executar N passos', () => {
    expect(executeLabel(1)).toBe('Executar');
    expect(executeLabel(5)).toBe('Executar 5 passos');
  });

  it('PEDIDO do Manual: literal "Igual ao viral · sem variação · 3 vídeos · quem aparece? · Omni 1.1 Flash · Nano Banana Pro (melhor rosto)"', () => {
    expect(pedidoSummary({ ...base, quantity: 3 }, [], 'Nano Banana Pro')).toBe('Igual ao viral · sem variação · 3 vídeos · quem aparece? · Omni 1.1 Flash · Nano Banana Pro (melhor rosto)');
  });
});
