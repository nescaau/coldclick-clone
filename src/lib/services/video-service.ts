/** Casos de uso de vídeos: upload, importação por URL, transcrição e exclusão. */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { MAX_VIDEO_BYTES, STORAGE_QUOTA_BYTES, VIDEO_TYPES } from '../config';
import { transaction } from '../db';
import { fileUrl } from '../format';
import { AppError as HttpError } from '../errors';
import { safeFetch } from '../net-guard';
import { deleteJobRow, listTranscriptionJobIdsForVideo } from '../repo/jobs';
import {
  countJobsUsingVideo,
  deleteVideoRow,
  findVideoRow,
  insertVideoRow,
  listVideoRows,
  type VideoRow,
} from '../repo/videos';
import { deleteFile, getStorageUsage, PayloadTooLargeError, safeBaseName, saveWebStream } from '../storage';
import type { Scene } from '../scenes';
import type { VideoDTO } from '../types';
import { cancelTranscription } from './transcription-service';

const toDTO = (r: VideoRow): VideoDTO => ({
  id: r.id,
  name: r.original_name,
  url: fileUrl(r.file_path),
  mime: r.mime,
  sizeBytes: r.size_bytes,
  durationSec: r.duration_sec,
  source: r.source,
  sourceUrl: r.source_url,
  transcript: r.transcript,
  transcriptLanguage: r.transcript_language,
  transcriptScenes: r.transcript_scenes ? (JSON.parse(r.transcript_scenes) as Scene[]) : null,
  createdAt: r.created_at,
});

export const listVideos = (): VideoDTO[] => listVideoRows().map(toDTO);

export function getVideo(id: string): VideoDTO {
  const row = findVideoRow(id);
  if (!row) throw new HttpError(404, 'Vídeo não encontrado');
  return toDTO(row);
}

/** Recusa o envio se o arquivo estourar a cota de armazenamento da conta. */
function assertQuotaFor(extraBytes: number): void {
  if (getStorageUsage().usedBytes + extraBytes > STORAGE_QUOTA_BYTES) {
    throw new HttpError(413, 'Espaço de armazenamento da conta insuficiente. Exclua vídeos antigos e tente novamente.');
  }
}

/** Grava o stream em disco respeitando o limite por arquivo e a cota, e registra o vídeo. */
async function storeVideoStream(input: {
  name: string;
  body: ReadableStream<Uint8Array>;
  declaredBytes: number | null;
  durationSec: number | null;
  source: 'upload' | 'url';
  sourceUrl: string | null;
}): Promise<VideoDTO> {
  const ext = path.extname(input.name).toLowerCase();
  const mime = VIDEO_TYPES[ext];
  if (!mime) throw new HttpError(415, 'Formato não suportado. Envie MP4, MOV ou WebM.');
  if (input.declaredBytes && input.declaredBytes > MAX_VIDEO_BYTES) {
    throw new HttpError(413, new PayloadTooLargeError(MAX_VIDEO_BYTES).message);
  }
  assertQuotaFor(input.declaredBytes ?? 0);

  const id = randomUUID();
  const filePath = `videos/${id}${ext}`;
  let size: number;
  try {
    size = await saveWebStream(filePath, input.body, MAX_VIDEO_BYTES);
  } catch (e) {
    if (e instanceof PayloadTooLargeError) throw new HttpError(413, e.message);
    throw e;
  }
  if (size === 0) {
    deleteFile(filePath);
    throw new HttpError(400, 'O arquivo está vazio');
  }

  insertVideoRow({
    id,
    originalName: input.name,
    filePath,
    mime,
    sizeBytes: size,
    durationSec: input.durationSec,
    source: input.source,
    sourceUrl: input.sourceUrl,
  });
  return getVideo(id);
}

export function uploadVideo(input: {
  name: string;
  body: ReadableStream<Uint8Array>;
  contentLength: number | null;
  durationSec: number | null;
}): Promise<VideoDTO> {
  return storeVideoStream({
    name: safeBaseName(input.name),
    body: input.body,
    declaredBytes: input.contentLength,
    durationSec: input.durationSec,
    source: 'upload',
    sourceUrl: null,
  });
}

const EXT_BY_MIME: Record<string, string> = {
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
};

/** decodeURIComponent que não explode com `%` malformado (URL inválida → usa o texto como veio). */
function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** Baixa um vídeo de um link direto (http/https público) e o registra. */
export async function importVideoFromUrl(rawUrl: string): Promise<VideoDTO> {
  // safeFetch valida cada salto (inclusive redirecionamentos), FIXA o IP validado na conexão (sem DNS rebinding)
  // e descarta o corpo das respostas 3xx.
  const res = await safeFetch(rawUrl);
  const ok = res.status >= 200 && res.status < 300;
  if (!ok) {
    void res.body.cancel().catch(() => undefined);
    throw new HttpError(502, `O link respondeu ${res.status || 'sem resposta'}`);
  }
  const current = res.url;
  const origin = new URL(rawUrl).toString();

  // Extensão: pelo caminho da URL ou, se não houver, pelo Content-Type.
  const mimeHeader = String(res.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  let name = safeBaseName(safeDecode(path.basename(current.pathname)) || 'video');
  if (!VIDEO_TYPES[path.extname(name).toLowerCase()]) {
    const ext = EXT_BY_MIME[mimeHeader];
    if (!ext) {
      void res.body.cancel().catch(() => undefined);
      throw new HttpError(415, 'O link não parece apontar para um vídeo MP4, MOV ou WebM.');
    }
    name = `${path.basename(name, path.extname(name))}${ext}`;
  }

  const declared = Number(res.headers['content-length']);
  return storeVideoStream({
    name,
    body: res.body,
    declaredBytes: Number.isFinite(declared) && declared > 0 ? declared : null,
    durationSec: null,
    source: 'url',
    sourceUrl: origin,
  });
}

/** Exclui o vídeo (e o arquivo) — recusado enquanto algum trabalho o usar. */
export function removeVideo(id: string): void {
  const row = findVideoRow(id);
  if (!row) throw new HttpError(404, 'Vídeo não encontrado');
  // Só trabalhos de GERAÇÃO bloqueiam. Transcrições do vídeo (inclusive em andamento) são abortadas e apagadas com ele.
  transaction(() => {
    const used = countJobsUsingVideo(id);
    if (used > 0) {
      throw new HttpError(409, `Este vídeo é usado por ${used} ${used === 1 ? 'trabalho' : 'trabalhos'} e não pode ser excluído.`);
    }
    for (const jobId of listTranscriptionJobIdsForVideo(id)) {
      cancelTranscription(jobId);
      deleteJobRow(jobId);
    }
    deleteVideoRow(id);
  });
  deleteFile(row.file_path);
}
