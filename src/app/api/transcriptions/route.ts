import { api, json, parseBody } from '@/lib/http';
import { transcribeSchema } from '@/lib/schemas';
import { getJob } from '@/lib/services/job-service';
import { transcribeVideoToScenes } from '@/lib/services/transcription-service';

export const maxDuration = 600;

/**
 * "Transcrever e dividir em cenas": cria um trabalho de transcrição, transcreve a fala do vídeo
 * (com tempos por palavra) e a divide em cenas de até 8 s.
 */
export const POST = api(async (req) => {
  const { videoId } = await parseBody(req, transcribeSchema);
  const { jobId, text, scenes } = await transcribeVideoToScenes(videoId);
  return json({ job: getJob(jobId), text, scenes }, 201);
});
