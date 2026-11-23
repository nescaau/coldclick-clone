import { api, json, parseBody } from '@/lib/http';
import { FeedbackSchema } from '@/lib/schemas';
import { sendFeedback } from '@/lib/services/feedback-service';

export const dynamic = 'force-dynamic';

export const POST = api(async (req) => json(sendFeedback(await parseBody(req, FeedbackSchema)), 201));
