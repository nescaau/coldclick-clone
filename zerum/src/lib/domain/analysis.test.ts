import { describe, expect, it } from 'vitest';
import { analysisBullets, clip, emptyAnalysis, ganchoOf, localAnalysis, readAnalysis, splitSpeech } from './analysis';

describe('análise do viral (honesta: só o que o arquivo informa)', () => {
  it('análise local só preenche o enquadramento a partir das dimensões reais; o resto fica vazio', () => {
    const a = localAnalysis({ durationS: 32, width: 1080, height: 1920, hasVideo: true, hasAudio: true });
    expect(a).toMatchObject({ origem: 'local', pessoas: [], transcricao: '', estrutura: '', tela: '', acoes: '', enquadramento: 'vertical 1080×1920' });
    expect(localAnalysis(null).enquadramento).toBe('');
  });

  it('gancho = primeira frase da transcrição (vazio sem transcrição)', () => {
    expect(ganchoOf({ transcricao: 'Let me show you what actually works. Get a pot of water going.' })).toBe('Let me show you what actually works.');
    expect(ganchoOf({ transcricao: '  ' })).toBe('');
    expect(ganchoOf({ transcricao: 'x'.repeat(300) }).length).toBeLessThanOrEqual(140);
  });

  it('marcadores: pessoas · fala, rosto, legenda e fatos do arquivo', () => {
    const a = { ...emptyAnalysis(), pessoas: [{ sexo: 'f' as const, fala: true, descricao: '', roupa: '' }], rosto: true, legenda: true, enquadramento: 'vertical 1080×1920' };
    expect(analysisBullets(a, { width: 1080, height: 1920, hasAudio: true })).toEqual(['1 pessoa em cena · fala', 'o rosto aparece', 'tem legenda na tela', 'vertical 1080×1920', 'com áudio']);
    expect(analysisBullets(emptyAnalysis(), { width: null, height: null, hasAudio: false })).toEqual(['sem faixa de áudio']);
  });

  it('clip corta com "..." como o original', () => {
    expect(clip('a'.repeat(250), 200)).toBe(`${'a'.repeat(200)}...`);
    expect(clip('curto', 200)).toBe('curto');
  });

  it('readAnalysis é tolerante a JSON corrompido/campos fora do limite', () => {
    expect(readAnalysis(null)).toBeNull();
    expect(readAnalysis('{nao é json')).toBeNull();
    const r = readAnalysis(JSON.stringify({ origem: 'corrigida', transcricao: 'a'.repeat(5000), pessoas: [{ sexo: 'x', fala: 1 }] }))!;
    expect(r.origem).toBe('corrigida');
    expect(r.transcricao.length).toBe(3000);
    expect(r.pessoas[0]).toEqual({ sexo: '', fala: true, descricao: '', roupa: '' });
  });

  it('splitSpeech distribui as frases entre as cenas sem inventar texto', () => {
    expect(splitSpeech('Um. Dois. Três. Quatro.', 2)).toEqual(['Um. Dois.', 'Três. Quatro.']);
    expect(splitSpeech('Só uma frase.', 3)).toEqual(['Só uma frase.', '', '']);
    expect(splitSpeech('', 2)).toEqual(['', '']);
  });
});
