import { JobDetail } from '@/components/jobs/JobDetail';
import { getJob } from '@/lib/services/job-service';
import { AppError } from '@/lib/errors';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  try {
    return <JobDetail initialJob={getJob((await params).id)} />;
  } catch (e) {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  }
}
