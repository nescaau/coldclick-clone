import { JobsList } from '@/components/jobs/JobsList';
import { listJobs } from '@/lib/services/job-service';

export const dynamic = 'force-dynamic';

export default function JobsPage() {
  return <JobsList initialJobs={listJobs()} />;
}
