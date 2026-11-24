import { describe, expect, it } from 'vitest';
import { parseMp4Meta } from './mp4';
import { buildMp4 } from './mp4-fixture';

describe('parseMp4Meta (metadados reais do arquivo)', () => {
  it('lê duração, dimensões e faixas de vídeo/áudio', () => {
    expect(parseMp4Meta(buildMp4({ durationS: 32, width: 1080, height: 1920 }))).toEqual({ durationS: 32, width: 1080, height: 1920, hasVideo: true, hasAudio: true });
  });

  it('sem faixa de áudio → hasAudio=false', () => {
    expect(parseMp4Meta(buildMp4({ audio: false }))?.hasAudio).toBe(false);
  });

  it('moov depois do mdat (sem faststart) também é lido', () => {
    expect(parseMp4Meta(buildMp4({ moovLast: true, durationS: 12.5 }))?.durationS).toBe(12.5);
  });

  it('mvhd versão 1 (duração em 64 bits)', () => {
    expect(parseMp4Meta(buildMp4({ v1: true, durationS: 45 }))?.durationS).toBe(45);
  });

  it('sem moov, truncado ou lixo → null (nunca lança)', () => {
    expect(parseMp4Meta(Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]))).toBeNull();
    expect(parseMp4Meta(buildMp4().subarray(0, 40))).toBeNull();
    expect(parseMp4Meta(new Uint8Array(64).fill(0xff))).toBeNull();
    expect(parseMp4Meta(new Uint8Array(0))).toBeNull();
  });
});
