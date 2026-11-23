import { getDb } from '../db';
import type { EventDTO } from '../types';

export type EventScope = 'viral' | 'batch' | 'conversation' | 'bridge';

/** Registra uma linha no log local. Também vai para o console do servidor (visível no terminal do `npm run dev`). */
export function logEvent(scope: EventScope, refId: string, message: string, level: EventDTO['level'] = 'info'): void {
  getDb().prepare('INSERT INTO events (scope, ref_id, level, message) VALUES (?, ?, ?, ?)').run(scope, refId, level, message);
  if (process.env.NODE_ENV !== 'test') console.log(`[zerum:${scope}] ${refId.slice(0, 8)} ${level}: ${message}`);
}

export function listEvents(scope: EventScope, refId: string, limit = 200): EventDTO[] {
  const rows = getDb()
    .prepare('SELECT id, level, message, created_at FROM events WHERE scope = ? AND ref_id = ? ORDER BY id ASC LIMIT ?')
    .all(scope, refId, limit) as { id: number; level: EventDTO['level']; message: string; created_at: string }[];
  return rows.map((r) => ({ id: r.id, level: r.level, message: r.message, createdAt: r.created_at }));
}

export function deleteEvents(scope: EventScope, refId: string): void {
  getDb().prepare('DELETE FROM events WHERE scope = ? AND ref_id = ?').run(scope, refId);
}
