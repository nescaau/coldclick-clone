import { getDb, newId, nowIso } from '../db';
import type { PathId, VariationId } from '../domain/plan';
import type { LanguageId } from '../domain/video-options';
import type { BatchState } from '../types';

export interface BatchRow {
  id: string;
  conversation_id: string | null;
  viral_id: string | null;
  viral_name: string | null;
  source: 'diretor' | 'manual';
  title: string;
  quantity: number;
  word: string;
  batch_name: string;
  bubble_on: number;
  bubble_color: string;
  language: LanguageId;
  request_text: string;
  state: BatchState;
  path: PathId;
  variation: VariationId;
  avatars: string;
  notes: string;
  stop_requested: number;
  archived: number;
  created_at: string;
  updated_at: string;
}

const SELECT = `SELECT b.*, v.name AS viral_name FROM batches b LEFT JOIN virals v ON v.id = b.viral_id`;

export const listBatchRows = (): BatchRow[] => getDb().prepare(`${SELECT} ORDER BY b.created_at DESC, b.rowid DESC`).all() as BatchRow[];

export const listBatchRowsByConversation = (conversationId: string): BatchRow[] =>
  getDb().prepare(`${SELECT} WHERE b.conversation_id = ? ORDER BY b.created_at DESC, b.rowid DESC`).all(conversationId) as BatchRow[];

export const getBatchRow = (id: string): BatchRow | undefined => getDb().prepare(`${SELECT} WHERE b.id = ?`).get(id) as BatchRow | undefined;

/** Lotes que ainda podem mudar de estado (o `tick` só olha estes). */
export const listActiveBatchRows = (): BatchRow[] =>
  getDb().prepare(`${SELECT} WHERE b.state IN ('preparando','na_fila','rodando') ORDER BY b.created_at ASC, b.rowid ASC`).all() as BatchRow[];

/** Lotes ativos que ainda aceitam vídeos novos (não parados, nem cancelados) — a fonte do próximo vídeo real. */
export const listClaimableBatchRows = (): BatchRow[] =>
  getDb().prepare(`${SELECT} WHERE b.state IN ('na_fila','rodando') AND b.stop_requested = 0 ORDER BY b.created_at ASC, b.rowid ASC`).all() as BatchRow[];

export interface NewBatch {
  conversationId: string | null;
  viralId: string | null;
  source: 'diretor' | 'manual';
  title: string;
  quantity: number;
  word: string;
  batchName: string;
  bubbleOn: boolean;
  bubbleColor: string;
  language: LanguageId;
  requestText: string;
  path: PathId;
  variation: VariationId;
  avatars: string[];
  notes: string;
}

export function insertBatch(b: NewBatch): BatchRow {
  const id = newId();
  const now = nowIso();
  getDb()
    .prepare(
      `INSERT INTO batches (id, conversation_id, viral_id, source, title, quantity, word, batch_name, bubble_on, bubble_color, language, request_text,
                            state, path, variation, avatars, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'na_fila', ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, b.conversationId, b.viralId, b.source, b.title, b.quantity, b.word, b.batchName, b.bubbleOn ? 1 : 0, b.bubbleColor, b.language, b.requestText, b.path, b.variation, JSON.stringify(b.avatars), b.notes, now, now);
  return getBatchRow(id)!;
}

export const setBatchState = (id: string, state: BatchState): void => {
  getDb().prepare('UPDATE batches SET state = ?, updated_at = ? WHERE id = ?').run(state, nowIso(), id);
};
export const setStopRequested = (id: string, v: boolean): void => {
  getDb().prepare('UPDATE batches SET stop_requested = ?, updated_at = ? WHERE id = ?').run(v ? 1 : 0, nowIso(), id);
};
export const setArchived = (id: string, v: boolean): void => {
  getDb().prepare('UPDATE batches SET archived = ?, updated_at = ? WHERE id = ?').run(v ? 1 : 0, nowIso(), id);
};
export const deleteBatch = (id: string): void => {
  getDb().prepare('DELETE FROM batches WHERE id = ?').run(id);
};
