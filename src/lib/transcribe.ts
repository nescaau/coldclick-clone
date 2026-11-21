/**
 * Transcrição da fala do vídeo via endpoint compatível com a API da OpenAI
 * (`POST {baseUrl}/audio/transcriptions`) — serve para OpenAI, Groq, servidores
 * whisper.cpp/faster-whisper locais etc.; basta trocar URL base, modelo e chave.
 *
 * Limite da API: ~25 MB por arquivo. Como vídeos podem ter até 500 MB, quando o
 * `ffmpeg` está instalado extraímos só o áudio (mono, 16 kHz, 32 kbps ≈ 14 MB/h).
 * Sem ffmpeg, só vídeos pequenos (≤ 25 MB) podem ser enviados diretamente.
 */
import { spawn } from 'node:child_process';
import { openAsBlob } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { TimedSegment, TimedWord } from './scenes';
import { getWhisperConfig } from './services/settings-service';
import { resolveStoragePath } from './storage';

const API_MAX_BYTES = 25 * 1024 * 1024;

export class TranscriptionConfigError extends Error {}

function runFfmpeg(args: string[], signal?: AbortSignal): Promise<{ ok: boolean; missing: boolean; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'], signal });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr = (stderr + d).slice(-2000)));
    child.on('error', (e: NodeJS.ErrnoException) => resolve({ ok: false, missing: e.code === 'ENOENT', stderr: e.message }));
    child.on('close', (code) => resolve({ ok: code === 0, missing: false, stderr }));
  });
}

export interface TranscriptionResult {
  text: string;
  language: string;
  words: TimedWord[];
  segments: TimedSegment[];
}

/** Etapas observáveis (viram as "Etapas registradas" do trabalho de transcrição). */
export type TranscriptionStep = 'audio-prepared' | 'sent' | 'received';

interface VerboseResponse {
  text?: string;
  language?: string;
  words?: Array<{ word: string; start: number; end: number }>;
  segments?: Array<{ text: string; start: number; end: number }>;
}

/**
 * Envia o áudio (ou o vídeo pequeno) ao endpoint de transcrição e devolve texto + tempos.
 * Pede `verbose_json` com timestamps por palavra e por segmento; se o serviço não aceitar esse
 * formato (alguns servidores compatíveis só entendem `json`), repete em modo simples (sem tempos).
 */
export async function transcribeVideoFile(
  videoRelPath: string,
  onStep?: (step: TranscriptionStep) => void,
  signal?: AbortSignal,
): Promise<TranscriptionResult> {
  const cfg = getWhisperConfig();
  if (!cfg.apiKey) {
    throw new TranscriptionConfigError('Configure a chave da API de transcrição em Configurações do estúdio.');
  }

  const source = resolveStoragePath(videoRelPath);
  let uploadPath = source;
  let tmpDir: string | null = null;

  try {
    // 1) Tenta extrair só o áudio (reduz de centenas de MB para poucos MB).
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'coldclick-audio-'));
    const audioPath = path.join(tmpDir, 'audio.mp3');
    const ff = await runFfmpeg(['-y', '-i', source, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k', audioPath], signal);

    if (ff.ok) {
      uploadPath = audioPath;
    } else if (signal?.aborted) {
      signal.throwIfAborted();
    } else if (ff.missing) {
      // 2) Sem ffmpeg: só dá para enviar o próprio vídeo se couber no limite da API.
      const { size } = await stat(source);
      if (size > API_MAX_BYTES) {
        throw new Error(
          'Este vídeo é grande demais para enviar direto (limite de 25 MB). Instale o ffmpeg (no Mac: "brew install ffmpeg") para extrair o áudio automaticamente, ou escreva a copy manualmente.',
        );
      }
    } else {
      throw new Error(`Não foi possível extrair o áudio do vídeo (ffmpeg): ${ff.stderr.split('\n').slice(-3).join(' ').trim()}`);
    }
    onStep?.('audio-prepared');

    const isAudio = uploadPath !== source;
    const blob = await openAsBlob(uploadPath, { type: isAudio ? 'audio/mpeg' : 'video/mp4' });
    const filename = isAudio ? 'audio.mp3' : path.basename(source);

    const request = async (verbose: boolean): Promise<Response> => {
      const form = new FormData();
      form.append('file', blob, filename);
      form.append('model', cfg.model);
      if (verbose) {
        form.append('response_format', 'verbose_json');
        form.append('timestamp_granularities[]', 'word');
        form.append('timestamp_granularities[]', 'segment');
      } else {
        form.append('response_format', 'json');
      }
      return fetch(`${cfg.baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.apiKey}` },
        body: form,
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10 * 60_000)]) : AbortSignal.timeout(10 * 60_000),
      });
    };

    onStep?.('sent');
    let res = await request(true);
    if (res.status === 400 || res.status === 422) res = await request(false);

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      throw new Error(`A API de transcrição respondeu ${res.status}: ${detail || res.statusText}`);
    }
    const data = (await res.json()) as VerboseResponse;
    signal?.throwIfAborted();
    onStep?.('received');
    return {
      text: (data.text ?? '').trim(),
      language: data.language ?? 'auto',
      words: (data.words ?? []).map((w) => ({ word: w.word, start: w.start, end: w.end })),
      segments: (data.segments ?? []).map((g) => ({ text: g.text, start: g.start, end: g.end })),
    };
  } finally {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  }
}
