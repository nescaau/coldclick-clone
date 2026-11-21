/** Repositório do catálogo de produtos (opcional em cada trabalho). Só SQL. */
import { getDb } from '../db';

export interface ProductRow {
  id: string;
  name: string;
  position: number;
}

export const listProductRows = (): ProductRow[] =>
  getDb().prepare('SELECT * FROM products ORDER BY position, name').all() as ProductRow[];

export function insertProductRow(id: string, name: string, position: number): void {
  getDb().prepare('INSERT OR IGNORE INTO products (id, name, position) VALUES (?, ?, ?)').run(id, name, position);
}
