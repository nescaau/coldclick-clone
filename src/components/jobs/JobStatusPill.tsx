import { JOB_STATUS_LABEL } from '@/lib/format';
import type { JobStatus } from '@/lib/types';
import { Pill } from '../ui';

const TONE: Record<JobStatus, 'neutral' | 'primary' | 'success' | 'warning' | 'destructive'> = {
  queued: 'neutral',
  running: 'primary',
  completed: 'success',
  partial: 'warning',
  failed: 'destructive',
  cancelled: 'neutral',
};

/** Pílula de status do trabalho (cores da referência: âmbar parcial, vermelho falha, verde pronto). */
export function JobStatusPill({ status }: { status: JobStatus }) {
  return (
    <Pill tone={TONE[status]} size="md">
      {JOB_STATUS_LABEL[status]}
    </Pill>
  );
}
