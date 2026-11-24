/**
 * Clipes baixados do Flow (geração REAL), guardados em data/flow/<sha256>.mp4. O nome é o hash do CONTEÚDO — nunca vem
 * de fora (sem path traversal) — e o mesmo arquivo não é guardado duas vezes.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { FLOW_DIR } from '../config';
import { parseRun } from '../domain/real-run';
import { countRealHashUsers, type VideoRow } from '../repo/videos';

export const flowFilePath = (hash: string): string => path.join(FLOW_DIR, `${hash}.mp4`);

/** Só hash hex de 64 caracteres vira caminho. */
export const isHash = (s: string): boolean => /^[0-9a-f]{64}$/.test(s);

export function storeClip(bytes: Uint8Array): { hash: string; size: number } {
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  const dest = flowFilePath(hash);
  fs.mkdirSync(FLOW_DIR, { recursive: true });
  if (!fs.existsSync(dest)) {
    const tmp = `${dest}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, dest);
  }
  return { hash, size: bytes.length };
}

export function readClip(hash: string): Uint8Array {
  if (!isHash(hash)) throw new Error('hash inválido');
  return fs.readFileSync(flowFilePath(hash));
}

export const clipExists = (hash: string): boolean => isHash(hash) && fs.existsSync(flowFilePath(hash));

/** Arquivos que pertencem a um vídeo (cenas + final). */
export function hashesOf(v: Pick<VideoRow, 'real_json' | 'scenes_total'>): string[] {
  const run = parseRun(v.real_json, v.scenes_total);
  if (!run) return [];
  return [...new Set([...run.scenes.map((s) => s.hash), run.final?.hash ?? ''].filter(isHash))];
}

/** Apaga os arquivos de um vídeo descartado — só os que nenhum outro vídeo usa. */
export function dropVideoFiles(v: VideoRow): void {
  for (const h of hashesOf(v)) if (countRealHashUsers(h, v.id) === 0) fs.rmSync(flowFilePath(h), { force: true });
}
