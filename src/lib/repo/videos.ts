/** Repositório de vídeos enviados. Só SQL: arquivos e regras de exclusão ficam no serviço. */
import { getDb } from '../db';

export interface VideoRow {
  id: string;
  original_name: string;
  file_path: string;
  mime: string;
  size_bytes: number;
  duration_sec: number | null;
  source: 'upload' | 'url';
  source_url: string | null;
  transcript: string | null;
  transcript_language: string | null;
  created_at: string;
}

export interface NewVideoRow {
  id: string;
  originalName: string;
  filePath: string;
  mime: string;
  sizeBytes: number;
  durationSec: number | null;
  source: 'upload' | 'url';
  sourceUrl: string | null;
}

export const listVideoRows = (): VideoRow[] =>
  getDb().prepare('SELECT * FROM videos ORDER BY created_at DESC').all() as VideoRow[];

export const findVideoRow = (id: string): VideoRow | null =>
  (getDb().prepare('SELECT * FROM videos WHERE id = ?').get(id) as VideoRow | undefined) ?? null;

export function insertVideoRow(v: NewVideoRow): void {
  getDb()
    .prepare(
      `INSERT INTO videos (id, original_name, file_path, mime, size_bytes, duration_sec, source, source_url)
       VALUES (@id, @originalName, @filePath, @mime, @sizeBytes, @durationSec, @source, @sourceUrl)`,
    )
    .run(v);
}

export function updateVideoTranscript(id: string, text: string, language: string): void {
  getDb().prepare('UPDATE videos SET transcript = ?, transcript_language = ? WHERE id = ?').run(text, language, id);
}

/** Quantos trabalhos usam este vídeo. */
export const countJobsUsingVideo = (id: string): number =>
  (getDb().prepare('SELECT COUNT(*) AS n FROM jobs WHERE video_id = ?').get(id) as { n: number }).n;

export const deleteVideoRow = (id: string): boolean => getDb().prepare('DELETE FROM videos WHERE id = ?').run(id).changes > 0;
