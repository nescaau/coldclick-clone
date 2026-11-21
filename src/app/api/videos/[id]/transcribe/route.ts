import { api, json, parseBody } from '@/lib/http';
import { transcribeSchema } from '@/lib/schemas';
import { transcribeVideo } from '@/lib/services/video-service';

export const maxDuration = 600;

/** Transcreve a fala do vídeo (Whisper) e guarda o resultado para reaproveitar em outros trabalhos. */
export const POST = api<{ id: string }>(async (req, { params }) => {
  const { language } = await parseBody(req, transcribeSchema);
  return json(await transcribeVideo((await params).id, language));
});
