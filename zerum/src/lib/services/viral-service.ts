/**
 * Virais ("Analisados"). O upload é REAL, mas 100% local: o MP4 é validado, deduplicado por sha256 e gravado em
 * data/virais/<hash>.mp4. A "leitura" é LOCAL e honesta: duração, dimensões e faixas vêm do próprio arquivo; gancho,
 * estrutura e falas ficam vazios até o usuário preencher em "A leitura errou? Corrigir" (a IA que assiste o vídeo é a
 * fase futura). Nenhuma chamada externa.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { VIRALS_DIR } from '../config';
import { transaction } from '../db';
import { AppError, notFound } from '../errors';
import { MAX_VIRAL_BYTES, MAX_VIRAL_MB } from '../limits';
import { fmtDuration, localAnalysis, type ViralAnalysis } from '../domain/analysis';
import { displayName, parseMp4Meta, validateViral } from '../domain/mp4';
import {
  deleteViral,
  getViral,
  getViralByHash,
  insertViral,
  listVirals,
  listViralsWithoutAnalysis,
  setAnalysis,
  setMeta,
  toViralDTO,
} from '../repo/virals';
import { logEvent, listEvents, deleteEvents } from '../repo/events';
import type { EventDTO, ViralDTO } from '../types';

const filePathFor = (hash: string) => path.join(VIRALS_DIR, `${hash}.mp4`);

export const listAllVirals = (): ViralDTO[] => listVirals().map(toViralDTO);

export function getViralDTO(id: string): ViralDTO {
  const v = getViral(id);
  if (!v) throw notFound('Viral');
  return toViralDTO(v);
}

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

  const meta = parseMp4Meta(input.bytes);
  const analysis = localAnalysis(meta);

  fs.mkdirSync(VIRALS_DIR, { recursive: true });
  const dest = filePathFor(hash);
  const tmp = `${dest}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, input.bytes);
  fs.renameSync(tmp, dest);
  try {
    const row = transaction(() => {
      const r = insertViral({
        hash,
        name,
        mime: 'video/mp4',
        sizeBytes: input.bytes.length,
        durationS: meta?.durationS ?? null,
        width: meta?.width ?? null,
        height: meta?.height ?? null,
        hasAudio: meta ? meta.hasAudio : null,
        analysis: JSON.stringify(analysis),
      });
      logEvent('viral', r.id, `Viral recebido: "${name}" (${mb(input.bytes.length)} MB).`);
      logEvent('viral', r.id, `Guardado em data/virais/${hash.slice(0, 12)}….mp4 — somente neste computador.`);
      if (meta) {
        const dur = meta.durationS !== null ? `duração ${fmtDuration(meta.durationS)}` : 'duração não informada no arquivo';
        const dim = meta.width && meta.height ? ` · ${meta.width}×${meta.height}` : '';
        logEvent('viral', r.id, `Leitura local do arquivo: ${dur}${dim} · ${meta.hasAudio ? 'com' : 'sem'} faixa de áudio.`);
      } else {
        logEvent('viral', r.id, 'Não consegui ler os metadados do MP4 (caixa moov ausente); o arquivo foi guardado mesmo assim.', 'aviso');
      }
      logEvent('viral', r.id, 'A IA do Diretor não assistiu o vídeo (fase futura): gancho, estrutura e falas ficam vazios — preencha em “A leitura errou? Corrigir”.', 'aviso');
      return r;
    });
    return { viral: toViralDTO(row), reused: false };
  } catch (e) {
    // Corrida no UNIQUE(hash): outro envio idêntico já tem registro e o MESMO arquivo em disco — não apagar o do vencedor.
    const winner = getViralByHash(hash);
    if (winner) {
      logEvent('viral', winner.id, `"${name}" já estava guardado — reaproveitado (envio simultâneo).`);
      return { viral: toViralDTO(winner), reused: true };
    }
    fs.rmSync(dest, { force: true }); // o banco recusou e ninguém é dono do arquivo: não deixa órfão
    throw e;
  }
}

/** "✎ Alterar análise" → "Confirmar alteração": guarda a análise corrigida (e a original, na 1ª vez, para "voltar à original"). */
export function correctAnalysis(id: string, input: Omit<ViralAnalysis, 'origem'>): ViralDTO {
  const v = getViral(id);
  if (!v) throw notFound('Viral');
  const next: ViralAnalysis = { ...input, origem: 'corrigida' };
  transaction(() => {
    setAnalysis(id, JSON.stringify(next), { keepOriginal: v.analysis ?? JSON.stringify(localAnalysis(null)) });
    logEvent('viral', id, 'Análise corrigida pelo usuário (a original fica guardada: “voltar à original”).');
  });
  return getViralDTO(id);
}

/** "voltar à original". */
export function revertAnalysis(id: string): ViralDTO {
  const v = getViral(id);
  if (!v) throw notFound('Viral');
  if (!v.analysis_original) throw new AppError(409, 'Esse viral não tem correção para desfazer.');
  transaction(() => {
    setAnalysis(id, v.analysis_original as string, { clearOriginal: true });
    logEvent('viral', id, 'Análise voltou à original.');
  });
  return getViralDTO(id);
}

/** Virais de antes da v2: preenche metadados/análise lendo o arquivo (uma vez). */
export function backfillViralMeta(): number {
  let n = 0;
  for (const v of listViralsWithoutAnalysis()) {
    let meta = null;
    try {
      meta = parseMp4Meta(fs.readFileSync(filePathFor(v.hash)));
    } catch {
      /* arquivo sumiu: segue sem metadados */
    }
    setMeta(v.id, { durationS: meta?.durationS ?? null, width: meta?.width ?? null, height: meta?.height ?? null, hasAudio: meta ? meta.hasAudio : null }, JSON.stringify(localAnalysis(meta)));
    logEvent('viral', v.id, 'Leitura local dos metadados concluída (viral guardado antes da atualização).');
    n++;
  }
  return n;
}

export type ViralMedia = { path: string; size: number; name: string };

/** Arquivo do viral para ▶ Assistir / ⬇ Baixar. */
export function viralMedia(id: string): ViralMedia {
  const v = getViral(id);
  if (!v) throw notFound('Viral');
  const p = filePathFor(v.hash);
  if (!fs.existsSync(p)) throw new AppError(404, 'O arquivo deste viral não está mais neste computador.');
  return { path: p, size: fs.statSync(p).size, name: v.name };
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
