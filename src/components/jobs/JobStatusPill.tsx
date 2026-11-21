import { jobStatusLabel } from '@/lib/format';
import type { JobDTO, JobStatus } from '@/lib/types';
import { Pill } from '../ui';

const TONE: Record<JobStatus, 'neutral' | 'primary' | 'success' | 'warning' | 'destructive'> = {
  queued: 'neutral',
  running: 'primary',
  completed: 'success',
  partial: 'warning',
  failed: 'destructive',
  cancelled: 'neutral',
};

/** Pílula de status (cores da referência: âmbar parcial, vermelho falha, verde pronto). */
export function JobStatusPill({ job }: { job: Pick<JobDTO, 'kind' | 'status'> }) {
  return (
    <Pill tone={TONE[job.status]} size="md">
      {jobStatusLabel(job)}
    </Pill>
  );
}
