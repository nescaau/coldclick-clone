import { getDb, newId, nowIso } from '../db';
import type { DirectorMode } from '../domain/director';
import type { MessageDTO, MessageRole } from '../types';

export interface ConversationRow {
  id: string;
  title: string;
  title_manual: number;
  mode: DirectorMode;
  viral_id: string | null;
  options: string;
  created_at: string;
  updated_at: string;
}

export const listConversations = (): ConversationRow[] =>
  getDb().prepare('SELECT * FROM conversations ORDER BY updated_at DESC, rowid DESC').all() as ConversationRow[];

export const getConversation = (id: string): ConversationRow | undefined =>
  getDb().prepare('SELECT * FROM conversations WHERE id = ?').get(id) as ConversationRow | undefined;

export function insertConversation(c: { mode: DirectorMode; options: string; viralId?: string | null }): ConversationRow {
  const id = newId();
  const now = nowIso();
  getDb()
    .prepare('INSERT INTO conversations (id, mode, viral_id, options, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, c.mode, c.viralId ?? null, c.options, now, now);
  return getConversation(id)!;
}

export function updateConversation(
  id: string,
  patch: Partial<{ title: string; titleManual: boolean; mode: DirectorMode; viralId: string | null; options: string }>,
): void {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (patch.title !== undefined) (sets.push('title = ?'), vals.push(patch.title));
  if (patch.titleManual !== undefined) (sets.push('title_manual = ?'), vals.push(patch.titleManual ? 1 : 0));
  if (patch.mode !== undefined) (sets.push('mode = ?'), vals.push(patch.mode));
  if (patch.viralId !== undefined) (sets.push('viral_id = ?'), vals.push(patch.viralId));
  if (patch.options !== undefined) (sets.push('options = ?'), vals.push(patch.options));
  sets.push('updated_at = ?');
  vals.push(nowIso(), id);
  getDb().prepare(`UPDATE conversations SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

export const deleteConversation = (id: string): void => {
  getDb().prepare('DELETE FROM conversations WHERE id = ?').run(id);
};

interface MessageRow {
  id: string;
  role: MessageRole;
  text: string;
  attachments: string;
  created_at: string;
}

const toMessage = (r: MessageRow): MessageDTO => {
  let attachments: { nome: string }[] = [];
  try {
    attachments = JSON.parse(r.attachments);
  } catch {
    /* anexos corrompidos viram lista vazia */
  }
  return { id: r.id, role: r.role, text: r.text, attachments, plan: null, createdAt: r.created_at };
};

export const listMessages = (conversationId: string): MessageDTO[] =>
  (
    getDb()
      .prepare('SELECT id, role, text, attachments, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC')
      .all(conversationId) as MessageRow[]
  ).map(toMessage);

export const countMessages = (conversationId: string): number =>
  (getDb().prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?').get(conversationId) as { n: number }).n;

export function insertMessage(conversationId: string, role: MessageRole, text: string, attachments: { nome: string }[] = []): MessageDTO {
  const id = newId();
  const now = nowIso();
  getDb()
    .prepare('INSERT INTO messages (id, conversation_id, role, text, attachments, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, conversationId, role, text, JSON.stringify(attachments), now);
  return { id, role, text, attachments, plan: null, createdAt: now };
}
