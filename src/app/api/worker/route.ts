import { z } from 'zod';
import { api, json, parseBody } from '@/lib/http';
import { getWorkerStatus, startWorker, stopWorker, tickNow } from '@/lib/worker';

export const GET = api(async () => {
  startWorker(); // garante o loop mesmo se o instrumentation não tiver rodado
  return json(getWorkerStatus());
});

const schema = z.object({ action: z.enum(['start', 'stop', 'tick']) });

/** Controle manual do worker (útil para depuração). */
export const POST = api(async (req) => {
  const { action } = await parseBody(req, schema);
  if (action === 'start') startWorker();
  if (action === 'stop') stopWorker();
  if (action === 'tick') tickNow();
  return json(getWorkerStatus());
});
