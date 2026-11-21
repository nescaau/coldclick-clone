/** Utilitários de formatação (seguros para cliente e servidor). */
import type { JobDTO, JobStatus } from './types';

export function fileUrl(relPath: string): string {
  return '/api/files/' + relPath.split('/').map(encodeURIComponent).join('/');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[i]}`;
}

/** Unidades binárias em pt-BR, como "503,4 MiB" e "2 GiB" (sem zero decimal desnecessário). */
export function formatBinaryBytes(bytes: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  const text = value.toLocaleString('pt-BR', { maximumFractionDigits: i === 0 ? 0 : 1, minimumFractionDigits: 0 });
  return `${text} ${units[i]}`;
}

export function formatDuration(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec)) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Rótulos de status. Trabalhos de transcrição ("prévia") têm vocabulário próprio na referência. */
const GENERATION_STATUS_LABEL: Record<JobStatus, string> = {
  queued: 'Na fila',
  running: 'Em andamento',
  completed: 'Concluído',
  partial: 'Concluído parcialmente',
  failed: 'Falhou',
  cancelled: 'Cancelado',
};
const TRANSCRIPTION_STATUS_LABEL: Record<JobStatus, string> = {
  queued: 'Na fila',
  running: 'Transcrevendo',
  completed: 'Prévia pronta',
  partial: 'Prévia pronta',
  failed: 'Falhou',
  cancelled: 'Cancelado',
};

type KindStatus = Pick<JobDTO, 'kind' | 'status'>;

export const jobStatusLabel = (job: KindStatus): string =>
  (job.kind === 'transcription' ? TRANSCRIPTION_STATUS_LABEL : GENERATION_STATUS_LABEL)[job.status];

export const isActiveStatus = (s: JobStatus) => s === 'queued' || s === 'running';

type Progress = Pick<
  JobDTO,
  | 'kind'
  | 'status'
  | 'phase'
  | 'variations'
  | 'videosDone'
  | 'failedAttempts'
  | 'imagesDone'
  | 'imagesFailed'
  | 'videosFailed'
  | 'stepsDone'
  | 'stepsTotal'
  | 'stepsPercent'
>;

/** Ex.: "20 de 20 vídeos concluídos · 3 falhas". */
export function formatProgress(job: Pick<JobDTO, 'videosDone' | 'variations' | 'failedAttempts'>): string {
  const base = `${job.videosDone} de ${job.variations} ${job.variations === 1 ? 'vídeo concluído' : 'vídeos concluídos'}`;
  return `${base} · ${job.failedAttempts} ${job.failedAttempts === 1 ? 'falha' : 'falhas'}`;
}

/**
 * Percentual de itens (imagens + vídeos) já processados — concluídos ou falhos —, 0–100.
 * Itens cancelados não contam como processados (um trabalho cancelado no início fica perto de 0%).
 */
export function overallPercent(
  job: Pick<JobDTO, 'variations' | 'imagesDone' | 'videosDone' | 'imagesFailed' | 'videosFailed'>,
): number {
  const total = job.variations * 2;
  if (total === 0) return 0;
  const processed = job.imagesDone + job.videosDone + job.imagesFailed + job.videosFailed;
  return Math.round((processed / total) * 100);
}

/** Percentual de etapas registradas de uma transcrição. */
const stepsPercent = (job: Pick<JobDTO, 'stepsPercent' | 'status'>): number => (job.status === 'completed' ? 100 : job.stepsPercent);

/**
 * Rótulo da esquerda abaixo do título na lista de trabalhos:
 * a fase em andamento ("Imagens"/"Vídeos") ou o desfecho da geração.
 */
export function phaseLabel(job: Progress): string {
  if (job.kind === 'transcription') return job.status === 'running' || job.status === 'queued' ? 'Transcrevendo áudio' : 'Prévia concluída';
  switch (job.status) {
    case 'completed':
      return 'Geração de vídeos concluída';
    case 'partial':
      return 'Geração de vídeos finalizada parcialmente';
    case 'failed':
      return 'Geração de vídeos falhou';
    default:
      return job.phase === 'videos' ? 'Vídeos' : 'Imagens';
  }
}

/** Texto da direita na lista de trabalhos. */
export function progressLabel(job: Progress): string {
  if (job.status === 'cancelled') return 'Cancelado';
  if (job.kind === 'transcription') {
    const pct = stepsPercent(job);
    return job.status === 'completed' ? 'Concluído · 100%' : job.status === 'failed' ? `Falhou · ${pct}%` : `Em andamento · ${pct}%`;
  }
  if (job.status === 'failed') return `Falhou · ${overallPercent(job)}%`;
  return formatProgress(job);
}

/** Largura da barra: vídeos prontos nos trabalhos encerrados; itens/etapas processados nos demais. */
export function progressPercent(job: Progress): number {
  if (job.kind === 'transcription') return stepsPercent(job);
  if (job.status === 'completed' || job.status === 'partial') {
    return job.variations ? Math.round((job.videosDone / job.variations) * 100) : 0;
  }
  return overallPercent(job);
}

/** "0min 16s" — tempo decorrido. */
export function formatElapsed(sec: number): string {
  return `${Math.floor(sec / 60)}min ${sec % 60}s`;
}

/** Palavras de um texto (para "25 palavras" no resumo). */
export const countWords = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

export function maskSecret(value: string): string {
  if (!value) return '';
  return `••••••••${value.slice(-4)}`;
}
