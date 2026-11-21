/** Repositório das etapas registradas de cada trabalho ("Etapas registradas · N"). Só SQL. */
import { randomUUID } from 'node:crypto';
import { getDb } from '../db';

export interface JobEventRow {
  id: string;
  job_id: string;
  label: string;
  status: 'done' | 'failed';
  created_at: string;
}

export function addJobEvent(jobId: string, label: string, status: 'done' | 'failed' = 'done'): void {
  getDb().prepare('INSERT INTO job_events (id, job_id, label, status) VALUES (?, ?, ?, ?)').run(randomUUID(), jobId, label, status);
}

export const listJobEventRows = (jobId: string): JobEventRow[] =>
  getDb().prepare('SELECT * FROM job_events WHERE job_id = ? ORDER BY created_at, rowid').all(jobId) as JobEventRow[];
