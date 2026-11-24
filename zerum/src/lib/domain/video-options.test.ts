import { describe, expect, it } from 'vitest';
import {
  BALLOON_COLORS,
  DEFAULT_BALLOON_COLOR,
  DEFAULT_OPTIONS,
  balloonLabel,
  contrastText,
  mergeOptions,
  normalizeHex,
  optionsSummary,
  sanitizeBatchName,
  sanitizeWord,
} from './video-options';

describe('cores do balão', () => {
  it('mantém as 8 cores do original, amarelo primeiro (#FFC400)', () => {
    expect(BALLOON_COLORS.map((c) => c.nome)).toEqual(['Amarelo', 'Verde', 'Vermelho', 'Azul', 'Rosa', 'Laranja', 'Branco', 'Preto']);
    expect(BALLOON_COLORS[0].hex).toBe('#FFC400');
    expect(DEFAULT_BALLOON_COLOR).toBe('#FFC400');
  });

  it('normalizeHex aceita #rgb, rgb, #rrggbb e devolve maiúsculo', () => {
    expect(normalizeHex('#fc0')).toBe('#FFCC00');
    expect(normalizeHex('ffc400')).toBe('#FFC400');
    expect(normalizeHex('  #ffc400 ')).toBe('#FFC400');
  });

  it('normalizeHex recusa lixo', () => {
    expect(normalizeHex('#ggg')).toBeUndefined();
    expect(normalizeHex('#12345')).toBeUndefined();
    expect(normalizeHex(42)).toBeUndefined();
    expect(normalizeHex('')).toBeUndefined();
  });

  it('contrastText: fundo claro → preto, escuro → branco', () => {
    expect(contrastText('#FFC400')).toBe('#000000');
    expect(contrastText('#FFFFFF')).toBe('#000000');
    expect(contrastText('#141414')).toBe('#FFFFFF');
    expect(contrastText('#3B82F6')).toBe('#FFFFFF');
    expect(contrastText('lixo')).toBe('#000000'); // cai no amarelo padrão
  });
});

describe('nome do lote e palavra', () => {
  it('sanitizeBatchName: só letras/números, sem acento, até 40', () => {
    expect(sanitizeBatchName('Umbigo')).toBe('Umbigo');
    expect(sanitizeBatchName('Lote Ação #1!')).toBe('LoteAcao1');
    expect(sanitizeBatchName('a'.repeat(60))).toHaveLength(40);
  });

  it('sanitizeWord: até 24, sem símbolos', () => {
    expect(sanitizeWord('Quero!')).toBe('Quero');
    expect(sanitizeWord('x'.repeat(40))).toHaveLength(24);
  });
});

describe('resumo e balão', () => {
  it('balloonLabel usa PALAVRA quando vazio e maiúsculas quando há palavra', () => {
    expect(balloonLabel('')).toBe('COMMENT "PALAVRA"');
    expect(balloonLabel(' link ')).toBe('COMMENT "LINK"');
  });

  it('optionsSummary: texto literal do original', () => {
    expect(optionsSummary(DEFAULT_OPTIONS)).toBe('sem palavra · balão ligado');
    expect(optionsSummary({ word: 'yes', bubbleOn: false })).toBe('palavra "YES" · balão desligado');
    // o nome do lote não entra no resumo (o original monta só palavra · balão)
    const comLote = { ...DEFAULT_OPTIONS, batchName: 'Umbigo' };
    expect(optionsSummary(comLote)).toBe('sem palavra · balão ligado');
  });
});

describe('mergeOptions', () => {
  it('aplica só o que veio e sanitiza', () => {
    const r = mergeOptions(DEFAULT_OPTIONS, { word: 'Oi!', batchName: 'Ação 2', bubbleColor: '#0f0', language: 'de' });
    expect(r).toEqual({ word: 'Oi', batchName: 'Acao2', bubbleOn: true, bubbleColor: '#00FF00', language: 'de' });
  });

  it('ignora cor e idioma inválidos', () => {
    const r = mergeOptions(DEFAULT_OPTIONS, { bubbleColor: 'zzz', language: 'fr' as never });
    expect(r.bubbleColor).toBe('#FFC400');
    expect(r.language).toBe('en');
  });

  it('não muta o objeto original', () => {
    const base = { ...DEFAULT_OPTIONS };
    mergeOptions(base, { bubbleOn: false });
    expect(base.bubbleOn).toBe(true);
  });
});
