import { Video } from 'lucide-react';
import { JobsHeader } from '@/components/jobs/JobsList';
import { PageLayout } from '@/components/PageLayout';
import { LinkButton, Skeleton } from '@/components/ui';
import { ROUTES } from '@/lib/nav';

/** Estado de carregamento: cabeçalho real + 4 linhas "skeleton" de 112px (como na referência). */
export default function Loading() {
  return (
    <PageLayout
      action={
        <LinkButton href={ROUTES.newJob} variant="primary">
          <Video /> Novo trabalho
        </LinkButton>
      }
    >
      <JobsHeader />
      <div className="mt-5 space-y-3" aria-busy="true" aria-label="Carregando trabalhos">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
    </PageLayout>
  );
}
