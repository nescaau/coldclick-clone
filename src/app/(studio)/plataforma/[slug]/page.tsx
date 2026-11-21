import Link from 'next/link';
import { LinkButton } from '@/components/ui';
import { PageLayout } from '@/components/PageLayout';
import { ROUTES } from '@/lib/nav';

/** Seções da plataforma principal (Painel, Ofertas, Vendas…) que não fazem parte desta réplica do Estúdio. */
export default function PlatformStubPage() {
  return (
    <PageLayout>
      <div className="mx-auto max-w-xl rounded-2xl border border-dashed border-border px-6 py-14 text-center">
        <p className="font-semibold">Esta seção pertence à plataforma principal</p>
        <p className="mt-1 text-muted-foreground">Ela não faz parte da réplica local do Estúdio Criativo.</p>
        <LinkButton href={ROUTES.jobs} variant="primary" className="mt-5">
          Ir para Trabalhos
        </LinkButton>
        <p className="mt-3 text-xs text-muted-foreground">
          <Link href={ROUTES.newJob} className="underline">
            Novo trabalho
          </Link>
        </p>
      </div>
    </PageLayout>
  );
}
