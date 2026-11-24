/** Apoio dos testes da extensão: relógio controlável, contexto de conta e um "coração" de aba executora falso. */
import { Broker } from '../background/broker.js';
import { createMediaStore } from '../background/media-store.js';
import { memoryKv } from '../lib/kv.js';

export const T0 = 1_700_000_000_000;
export const PROJECT = '11111111-1111-4111-8111-111111111111';
export const PROJECT_B = '22222222-2222-4222-8222-222222222222';
export const ctx = (accountId = 'ana@gmail.com', projectId = PROJECT, accountPath = '') => ({ accountId, projectId, accountPath });

export function makeEnv({ kv = memoryKv(), start = T0 } = {}) {
  const clock = { t: start };
  let n = 0;
  const media = createMediaStore(kv);
  const make = () => new Broker({ kv, media, now: () => clock.t, uid: () => `id-${++n}` });
  return { kv, media, clock, broker: make(), remake: make, advance: (ms) => (clock.t += ms) };
}

/** Argumentos válidos de um `generate.video`. */
export const videoArgs = (extra = {}) => [{ prompt: 'A woman says hello', aspectRatio: '9:16', durationSeconds: 8, ...extra }];

/** Pedido `enqueue` completo (com valores padrão). */
export const order = (o = {}) => ({ jobId: 'cena:v1:0', context: ctx(), cmd: 'generate.video', args: videoArgs(), key: 'k1', attempt: 0, ...o });

/** Uma batida do coração da aba executora. */
export const beat = (broker, o = {}) => broker.heartbeat({ context: ctx(), worker: 'w1', events: [], capacity: 2, credits: 100, ...o });

/** Grava um MP4 "falso" no store (como o worker faz antes de dizer `completed`). */
export async function deliverClip(media, orderId, bytes = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 1, 2, 3, 4, 5, 6, 7, 8])) {
  const meta = await media.putBytes(orderId, bytes, 'video/mp4');
  return { bytes: meta.size, mediaRef: `m-${orderId}` };
}
