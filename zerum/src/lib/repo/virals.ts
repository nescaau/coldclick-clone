import { getDb, newId, nowIso } from '../db';
import { ganchoOf, readAnalysis } from '../domain/analysis';
import type { ViralDTO } from '../types';

export interface ViralRow {
  id: string;
  hash: string;
  name: string;
  mime: string;
  size_bytes: number;
  state: 'preparando' | 'analisado';
  created_at: string;
  duration_s: number | null;
  width: number | null;
  height: number | null;
  has_audio: number | null;
  analysis: string | null;
  analysis_original: string | null;
}

export const toViralDTO = (r: ViralRow): ViralDTO => {
  const analysis = readAnalysis(r.analysis);
  return {
    id: r.id,
    name: r.name,
    sizeBytes: r.size_bytes,
    state: r.state,
    durationS: r.duration_s,
    width: r.width,
    height: r.height,
    hasAudio: r.has_audio === null ? null : !!r.has_audio,
    analysis,
    corrected: !!r.analysis_original,
    gancho: analysis ? ganchoOf(analysis) : '',
    createdAt: r.created_at,
  };
};

export const listVirals = (): ViralRow[] =>
  getDb().prepare('SELECT * FROM virals ORDER BY created_at DESC, rowid DESC').all() as ViralRow[];

export const getViral = (id: string): ViralRow | undefined =>
  getDb().prepare('SELECT * FROM virals WHERE id = ?').get(id) as ViralRow | undefined;

export const getViralByHash = (hash: string): ViralRow | undefined =>
  getDb().prepare('SELECT * FROM virals WHERE hash = ?').get(hash) as ViralRow | undefined;

export interface NewViral {
  hash: string;
  name: string;
  mime: string;
  sizeBytes: number;
  durationS: number | null;
  width: number | null;
  height: number | null;
  hasAudio: boolean | null;
  analysis: string;
}

export function insertViral(v: NewViral): ViralRow {
  const id = newId();
  getDb()
    .prepare(
      `INSERT INTO virals (id, hash, name, mime, size_bytes, state, duration_s, width, height, has_audio, analysis, created_at)
       VALUES (?, ?, ?, ?, ?, 'analisado', ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, v.hash, v.name, v.mime, v.sizeBytes, v.durationS, v.width, v.height, v.hasAudio === null ? null : v.hasAudio ? 1 : 0, v.analysis, nowIso());
  return getViral(id)!;
}

/** Grava a análise; `keepOriginal` guarda a análise anterior na PRIMEIRA correção (para "voltar à original"). */
export function setAnalysis(id: string, analysis: string, opts: { keepOriginal?: string | null; clearOriginal?: boolean } = {}): void {
  const db = getDb();
  if (opts.clearOriginal) db.prepare("UPDATE virals SET analysis = ?, analysis_original = NULL, state = 'analisado' WHERE id = ?").run(analysis, id);
  else if (opts.keepOriginal) {
    db.prepare("UPDATE virals SET analysis = ?, analysis_original = COALESCE(analysis_original, ?), state = 'analisado' WHERE id = ?").run(analysis, opts.keepOriginal, id);
  } else db.prepare("UPDATE virals SET analysis = ?, state = 'analisado' WHERE id = ?").run(analysis, id);
}

/** Virais guardados antes da v2 (sem análise): o bootstrap preenche com os metadados do arquivo. */
export const listViralsWithoutAnalysis = (): ViralRow[] =>
  getDb().prepare('SELECT * FROM virals WHERE analysis IS NULL').all() as ViralRow[];

export function setMeta(id: string, m: { durationS: number | null; width: number | null; height: number | null; hasAudio: boolean | null }, analysis: string): void {
  getDb()
    .prepare("UPDATE virals SET duration_s = ?, width = ?, height = ?, has_audio = ?, analysis = ?, state = 'analisado' WHERE id = ?")
    .run(m.durationS, m.width, m.height, m.hasAudio === null ? null : m.hasAudio ? 1 : 0, analysis, id);
}

export const deleteViral = (id: string): void => {
  getDb().prepare('DELETE FROM virals WHERE id = ?').run(id);
};
