import { describe, expect, it } from 'vitest';
import { COMPOSER_PLACEHOLDER, composerPlaceholder, conversationTitle, formatHour, parseQuantity, planRequest } from './director';

describe('parseQuantity', () => {
  it.each([
    ['quero esse vídeo igual, 3 vídeos, com pessoas novas', 3],
    ['faz 20', 20],
    ['gera 2 vídeos de cada', 2],
    ['gera dois vídeos', 2],
    ['monta cinco', 5],
    ['quero três vídeos', 3],
    ['1 vídeo só', 1],
  ])('%s → %i', (txt, n) => expect(parseQuantity(txt)).toBe(n));

  it('devolve null quando não há quantidade', () => {
    expect(parseQuantity('troca a abertura')).toBeNull();
    expect(parseQuantity('take único')).toBeNull();
    expect(parseQuantity('')).toBeNull();
  });

  it('não confunde duração/cenas com quantidade', () => {
    expect(parseQuantity('gera 30 segundos')).toBeNull();
    expect(parseQuantity('quero 4 cenas')).toBeNull();
  });

  it('limita ao teto de 50 e ignora zero', () => {
    expect(parseQuantity('faz 999')).toBe(50);
    expect(parseQuantity('faz 0')).toBeNull();
  });
});

describe('conversationTitle', () => {
  it('sem fala da aluna → "Nova conversa"', () => {
    expect(conversationTitle([])).toBe('Nova conversa');
    expect(conversationTitle([{ role: 'diretor', text: 'oi' }])).toBe('Nova conversa');
  });

  it('só anexo → "Referência: nome"', () => {
    expect(conversationTitle([{ role: 'aluna', text: '  ', attachments: [{ nome: 'ref.mp4' }] }])).toBe('Referência: ref.mp4');
  });

  it('usa a 1ª fala, tira prefixo [..] e capitaliza', () => {
    expect(conversationTitle([{ role: 'aluna', text: '[viral] quero 3 vídeos' }])).toBe('Quero 3 vídeos');
  });

  it('corta falas longas em 48 caracteres com reticências', () => {
    const t = conversationTitle([{ role: 'aluna', text: 'quero um vídeo igual a esse mas com uma enfermeira negra de sessenta anos explicando tudo' }]);
    expect(t.length).toBeLessThanOrEqual(48);
    expect(t.endsWith('…')).toBe(true);
  });
});

describe('composerPlaceholder', () => {
  it('textos literais do original por modo/estado', () => {
    expect(composerPlaceholder('ideia', false)).toBe('Descreva o vídeo que você quer…');
    expect(composerPlaceholder('viral', true)).toBe('O que você quer fazer com esse viral?');
    expect(composerPlaceholder('viral', false)).toBe(COMPOSER_PLACEHOLDER.semViral);
    expect(COMPOSER_PLACEHOLDER.semViral).toBe('Conte a sua ideia ou arraste o viral acima. Pode anexar imagem/vídeo de referência no 📎 (Enter envia)');
  });
});

describe('planRequest', () => {
  it('vazio não vira lote', () => {
    expect(planRequest({ mode: 'ideia', hasViral: false, text: '  ' })).toEqual({ ok: false, reason: 'vazio' });
  });
  it('modo viral exige viral', () => {
    expect(planRequest({ mode: 'viral', hasViral: false, text: 'faz 2' })).toEqual({ ok: false, reason: 'sem-viral' });
  });
  it('modo ideia dispensa viral; quantidade padrão 1', () => {
    expect(planRequest({ mode: 'ideia', hasViral: false, text: 'uma enfermeira' })).toEqual({ ok: true, quantity: 1 });
    expect(planRequest({ mode: 'viral', hasViral: true, text: 'faz 20' })).toEqual({ ok: true, quantity: 20 });
  });
});

describe('formatHour', () => {
  it('HH:MM', () => expect(formatHour('2026-11-23T14:31:00Z')).toMatch(/^\d{2}:\d{2}$/));
  it('data inválida não quebra', () => expect(typeof formatHour('xx')).toBe('string'));
});
