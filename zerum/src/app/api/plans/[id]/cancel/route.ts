import { api, json } from '@/lib/http';
import { cancelPlan } from '@/lib/services/director-service';

export const dynamic = 'force-dynamic';

export const POST = api<{ id: string }>(async (_req, { params }) => json({ conversation: cancelPlan((await params).id) }));
