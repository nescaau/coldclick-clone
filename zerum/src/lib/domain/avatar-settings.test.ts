import { describe, expect, it } from 'vitest';
import { MAX_PHOTO_BYTES, photoFileName, sniffImage, validatePhoto } from './avatar';
import { DEFAULT_SUBTITLE, maskKey, sanitizeSubtitle } from './settings';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

describe('foto do avatar: validada pelo conteúdo', () => {
  it('reconhece JPEG, PNG e WEBP pelas assinaturas', () => {
    expect(sniffImage(PNG)).toEqual({ mime: 'image/png', ext: 'png' });
    expect(sniffImage(JPG)).toEqual({ mime: 'image/jpeg', ext: 'jpg' });
    expect(sniffImage(WEBP)).toEqual({ mime: 'image/webp', ext: 'webp' });
    expect(sniffImage(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBeNull(); // GIF
    expect(sniffImage(new Uint8Array(0))).toBeNull();
  });

  it('mensagens: vazio, grande demais (20 MB) e "não é uma foto"', () => {
    expect(validatePhoto(new Uint8Array(0))).toEqual({ ok: false, error: 'O arquivo está vazio.' });
    expect(validatePhoto(new Uint8Array(MAX_PHOTO_BYTES + 1))).toMatchObject({ ok: false, error: expect.stringMatching(/O limite é 20 MB/) });
    expect(validatePhoto(new TextEncoder().encode('<svg onload=alert(1)>'))).toMatchObject({ ok: false, error: expect.stringMatching(/não é uma foto/) });
    expect(validatePhoto(PNG)).toMatchObject({ ok: true });
  });

  it('nome do arquivo no zip = nome do avatar, sem caracteres de caminho', () => {
    expect(photoFileName('PF 1', 'jpg')).toBe('PF 1.jpg');
    expect(photoFileName('a/b\\c:d', 'png')).toBe('abcd.png');
    expect(photoFileName('  ', 'png')).toBe('avatar.png');
  });
});

describe('legenda e chave (⚙)', () => {
  it('padrão literal: amarelo #FFFF00, 3 palavras, embaixo, 100 %, Poppins Bold, sem padrão salvo', () => {
    expect(DEFAULT_SUBTITLE).toMatchObject({ color: '#FFFF00', words: 3, position: 'embaixo', size: 100, font: 'Poppins Bold', saved: false });
  });

  it('sanitizeSubtitle normaliza hex, recusa valores fora das opções e limita faixas', () => {
    const r = sanitizeSubtitle({ color: 'f65cb4', words: 5, style: 'karaokê', position: 'em cima', size: 999, height: -5, font: 'Anton' }, DEFAULT_SUBTITLE);
    expect(r).toMatchObject({ color: '#F65CB4', words: 5, style: 'karaokê', position: 'em cima', size: 200, height: 0, font: 'Anton' });
    expect(sanitizeSubtitle({ color: 'xyz', words: 7 as never, font: 'Comic Sans' as never }, DEFAULT_SUBTITLE)).toMatchObject({ color: '#FFFF00', words: 3, font: 'Poppins Bold' });
  });

  it('a chave nunca aparece inteira: só os 4 últimos caracteres', () => {
    expect(maskKey('sk-segredo-1234')).toBe('••••1234');
  });
});
