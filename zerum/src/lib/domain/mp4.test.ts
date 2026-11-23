import { describe, expect, it } from 'vitest';
import { MAX_VIRAL_BYTES } from '../limits';
import { displayName, looksLikeMp4, validateViral } from './mp4';

const mp4Head = () => new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]);

describe('looksLikeMp4', () => {
  it('reconhece a caixa ftyp', () => expect(looksLikeMp4(mp4Head())).toBe(true));
  it('recusa outros conteúdos', () => {
    expect(looksLikeMp4(new Uint8Array(16))).toBe(false);
    expect(looksLikeMp4(new TextEncoder().encode('<html>...........'))).toBe(false);
    expect(looksLikeMp4(new Uint8Array(4))).toBe(false);
  });
});

describe('validateViral', () => {
  it('aceita um MP4 pequeno', () => expect(validateViral({ name: 'a.mp4', size: 1000, head: mp4Head() })).toEqual({ ok: true }));
  it('recusa vazio, grande, não-.mp4 e conteúdo falso', () => {
    expect(validateViral({ name: 'a.mp4', size: 0, head: mp4Head() }).ok).toBe(false);
    expect(validateViral({ name: 'a.mp4', size: MAX_VIRAL_BYTES + 1, head: mp4Head() })).toEqual({ ok: false, error: 'O vídeo passa de 60 MB.' });
    expect(validateViral({ name: 'a.mov', size: 10, head: mp4Head() }).ok).toBe(false);
    expect(validateViral({ name: 'a.mp4', size: 10, head: new Uint8Array(16) }).ok).toBe(false);
  });
  it('aceita exatamente o limite', () => expect(validateViral({ name: 'a.MP4', size: MAX_VIRAL_BYTES, head: mp4Head() }).ok).toBe(true));
});

describe('displayName', () => {
  it('tira caminho e caracteres de controle, limita o tamanho', () => {
    expect(displayName('C:\\Users\\x\\ref.mp4')).toBe('ref.mp4');
    expect(displayName('../../etc/passwd.mp4')).toBe('passwd.mp4');
    expect(displayName('a\u0000b.mp4')).toBe('ab.mp4');
    expect(displayName('')).toBe('viral.mp4');
    expect(displayName('x'.repeat(300))).toHaveLength(120);
  });
});
