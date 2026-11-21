import { api, json } from '@/lib/http';
import { retryFailedItems } from '@/lib/services/job-service';
import { startWorker } from '@/lib/worker';

/** Reexecuta somente os itens que falharam em definitivo. */
export const POST = api<{ id: string }>(async (_req, { params }) => {
  const job = retryFailedItems((await params).id);
  startWorker();
  return json(job);
});
