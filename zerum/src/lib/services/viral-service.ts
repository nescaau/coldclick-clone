/**
 * Virais ("Analisados"). O upload é REAL, mas 100% local: o MP4 é validado, deduplicado por sha256 e gravado em
 * data/virais/<hash>.mp4. A "leitura" do Diretor (assistir o vídeo e copiar a estrutura) depende de IA + executor,
 * então aqui o viral fica em "preparando" com log — nenhuma chamada externa.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { VIRALS_DIR } from '../config';
import { transaction } from '../db';
import { AppError, notFound } from '../errors';
import { MAX_VIRAL_BYTES, MAX_VIRAL_MB } from '../limits';
import { displayName, validateViral } from '../domain/mp4';
import { deleteViral, getViral, getViralByHash, insertViral, listVirals, toViralDTO } from '../repo/virals';
import { logEvent, listEvents, deleteEvents } from '../repo/events';
import type { EventDTO, ViralDTO } from '../types';

const filePathFor = (hash: string) => path.join(VIRALS_DIR, `${hash}.mp4`);

export const listAllVirals = (): ViralDTO[] => listVirals().map(toViralDTO);

export function viralEvents(id: string): EventDTO[] {
  if (!getViral(id)) throw notFound('Viral');
  return listEvents('viral', id);
}

const mb = (n: number) => (n / (1024 * 1024)).toFixed(1).replace('.', ',');

export function storeViral(input: { name: string; bytes: Uint8Array }): { viral: ViralDTO; reused: boolean } {
  const name = displayName(input.name);
  if (input.bytes.length > MAX_VIRAL_BYTES) throw new AppError(413, `O vídeo passa de ${MAX_VIRAL_MB} MB.`);
  const check = validateViral({ name, size: input.bytes.length, head: input.bytes.subarray(0, 16) });
  if (!check.ok) throw new AppError(400, check.error);

  const hash = crypto.createHash('sha256').update(input.bytes).digest('hex');
  const existing = getViralByHash(hash);
  if (existing) {
    logEvent('viral', existing.id, `"${name}" já estava guardado — reaproveitado (sem reenviar nada).`);
    return { viral: toViralDTO(existing), reused: true };
  }

  fs.mkdirSync(VIRALS_DIR, { recursive: true });
  const dest = filePathFor(hash);
  const tmp = `${dest}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, input.bytes);
  fs.renameSync(tmp, dest);
  try {
    const row = transaction(() => {
      const r = insertViral({ hash, name, mime: 'video/mp4', sizeBytes: input.bytes.length });
      logEvent('viral', r.id, `Viral recebido: "${name}" (${mb(input.bytes.length)} MB).`);
      logEvent('viral', r.id, `Guardado em data/virais/${hash.slice(0, 12)}….mp4 — somente neste computador.`);
      logEvent('viral', r.id, 'Leitura do Diretor: fase futura (exige IA + executor). Estado: preparando — nenhuma chamada externa.', 'aviso');
      return r;
    });
    return { viral: toViralDTO(row), reused: false };
  } catch (e) {
    fs.rmSync(dest, { force: true }); // o banco recusou: não deixa arquivo órfão
    throw e;
  }
}

export function removeViral(id: string): void {
  const v = getViral(id);
  if (!v) throw notFound('Viral');
  transaction(() => {
    deleteViral(id);
    deleteEvents('viral', id);
  });
  fs.rmSync(filePathFor(v.hash), { force: true });
}
