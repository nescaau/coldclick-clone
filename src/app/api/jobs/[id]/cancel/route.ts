import { api, json } from '@/lib/http';
import { cancelJob } from '@/lib/services/job-service';

export const POST = api<{ id: string }>(async (_req, { params }) => json(cancelJob((await params).id)));
