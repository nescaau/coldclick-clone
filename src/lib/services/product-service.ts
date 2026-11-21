/**
 * Catálogo de produtos (campo opcional do trabalho). Nesta réplica a lista é local: vem de um seed
 * com os produtos da plataforma de referência e não tem tela de edição.
 */
import { randomUUID } from 'node:crypto';
import { transaction } from '../db';
import { insertProductRow, listProductRows } from '../repo/products';
import { getRawSetting, setRawSetting } from '../repo/settings';

const SEED_FLAG = 'seeded_products_v1';
const SEED_PRODUCTS = ['Leantide', 'VitalFlush', 'linfozen'];

export const listProductNames = (): string[] => listProductRows().map((p) => p.name);

/** Cria os produtos de exemplo na primeira execução. Idempotente. */
export function seedProductsOnce(): void {
  if (getRawSetting(SEED_FLAG)) return;
  transaction(() => {
    SEED_PRODUCTS.forEach((name, i) => insertProductRow(randomUUID(), name, i));
    setRawSetting(SEED_FLAG, '1');
  });
}
