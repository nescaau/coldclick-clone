/** Repositório das contas Google (Flow) e do estado do ciclo de rotação. Só SQL. */
import { getDb, nowIso } from '../db';

export interface AccountRow {
  id: string;
  email: string;
  label: string | null;
  credits: number;
  enabled: number;
  position: number;
  cycle_videos: number;
  cycle_images: number;
  total_videos: number;
  total_images: number;
  last_used_at: string | null;
  credits_updated_at: string | null;
}

export interface RotationStateRow {
  cycle: number;
  cycle_started_at: string;
}

/** Em ordem de prioridade (a mesma usada pela rotação). */
export const listAccountRows = (): AccountRow[] =>
  getDb().prepare('SELECT * FROM google_accounts ORDER BY position, rowid').all() as AccountRow[];

export const findAccountRow = (id: string): AccountRow | null =>
  (getDb().prepare('SELECT * FROM google_accounts WHERE id = ?').get(id) as AccountRow | undefined) ?? null;

export function insertAccountRow(a: { id: string; email: string; label: string | null; credits: number }): void {
  const db = getDb();
  const next = (db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS n FROM google_accounts').get() as { n: number }).n;
  db.prepare(
    'INSERT INTO google_accounts (id, email, label, credits, credits_updated_at, position) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(a.id, a.email, a.label, a.credits, nowIso(), next);
}

export function updateAccountRow(
  id: string,
  patch: { label?: string | null; credits?: number; enabled?: boolean },
): void {
  const sets: string[] = [];
  const params: Array<string | number | null> = [];
  if (patch.label !== undefined) {
    sets.push('label = ?');
    params.push(patch.label);
  }
  if (patch.credits !== undefined) {
    sets.push('credits = ?', 'credits_updated_at = ?');
    params.push(patch.credits, nowIso());
  }
  if (patch.enabled !== undefined) {
    sets.push('enabled = ?');
    params.push(patch.enabled ? 1 : 0);
  }
  if (sets.length === 0) return;
  getDb().prepare(`UPDATE google_accounts SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
}

/** Troca a posição de duas contas (mover para cima/baixo). */
export function swapAccountPositions(a: AccountRow, b: AccountRow): void {
  const stmt = getDb().prepare('UPDATE google_accounts SET position = ? WHERE id = ?');
  stmt.run(b.position, a.id);
  stmt.run(a.position, b.id);
}

export const deleteAccountRow = (id: string): boolean =>
  getDb().prepare('DELETE FROM google_accounts WHERE id = ?').run(id).changes > 0;

/** Registra o uso de uma conta (contadores do ciclo + histórico). */
export function recordAccountUsage(id: string, kind: 'video' | 'image'): void {
  const col = kind === 'video' ? 'cycle_videos' : 'cycle_images';
  const total = kind === 'video' ? 'total_videos' : 'total_images';
  getDb()
    .prepare(`UPDATE google_accounts SET ${col} = ${col} + 1, ${total} = ${total} + 1, last_used_at = ? WHERE id = ?`)
    .run(nowIso(), id);
}

export const getRotationStateRow = (): RotationStateRow =>
  getDb().prepare('SELECT cycle, cycle_started_at FROM rotation_state WHERE id = 1').get() as RotationStateRow;

/** Zera os contadores do ciclo de todas as contas e incrementa o número do ciclo. */
export function resetCycle(): void {
  const db = getDb();
  db.prepare('UPDATE google_accounts SET cycle_videos = 0, cycle_images = 0').run();
  db.prepare('UPDATE rotation_state SET cycle = cycle + 1, cycle_started_at = ? WHERE id = 1').run(nowIso());
}
