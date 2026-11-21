import { api, json, parseBody } from '@/lib/http';
import { createJobSchema } from '@/lib/schemas';
import { createJob, listJobs } from '@/lib/services/job-service';
import { startWorker } from '@/lib/worker';

export const GET = api(async () => json(listJobs()));

/** Dispara um trabalho: grava na fila e garante que o worker está rodando. */
export const POST = api(async (req) => {
  const job = createJob(await parseBody(req, createJobSchema));
  startWorker();
  return json(job, 201);
});
