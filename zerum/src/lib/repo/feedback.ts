import { getDb, newId } from '../db';

export function insertFeedback(f: { kind: 'bug' | 'sugestao'; text: string }): string {
  const id = newId();
  getDb().prepare('INSERT INTO feedback (id, kind, text) VALUES (?, ?, ?)').run(id, f.kind, f.text);
  return id;
}

export const countFeedback = (): number => (getDb().prepare('SELECT COUNT(*) AS n FROM feedback').get() as { n: number }).n;
