'use client';

import { ArrowRight, Search, Video } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { PageHeading, PageLayout } from '../PageLayout';
import { apiFetch, useInterval } from '@/lib/client';
import { isActiveStatus, phaseLabel, progressLabel, progressPercent } from '@/lib/format';
import { ROUTES } from '@/lib/nav';
import type { JobDTO, JobStatus } from '@/lib/types';
import { cn, EmptyState, LinkButton, ProgressBar } from '../ui';
import { JobStatusPill } from './JobStatusPill';

export const JOB_FILTERS: Array<{ id: string; label: string; match: (s: JobStatus) => boolean }> = [
  { id: 'all', label: 'Todos', match: () => true },
  { id: 'running', label: 'Em andamento', match: isActiveStatus },
  { id: 'completed', label: 'Concluídos', match: (s) => s === 'completed' },
  { id: 'partial', label: 'Parciais', match: (s) => s === 'partial' },
  { id: 'failed', label: 'Com falha', match: (s) => s === 'failed' },
  { id: 'cancelled', label: 'Cancelados', match: (s) => s === 'cancelled' },
];

/** Cabeçalho da página — compartilhado com o estado de carregamento (loading.tsx). */
export function JobsHeader({ search, onSearch, activeFilter, onFilter }: { search?: string; onSearch?: (v: string) => void; activeFilter?: string; onFilter?: (id: string) => void }) {
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeading
          eyebrow="Estúdio criativo · Produção"
          title="Trabalhos"
          description="Reabra a configuração original e acesse o acompanhamento e os arquivos da geração."
        />
        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            aria-label="Buscar trabalhos"
            placeholder="Buscar por nome ou produto"
            className="field pl-9"
            value={search ?? ''}
            onChange={(e) => onSearch?.(e.target.value)}
            readOnly={!onSearch}
          />
        </div>
      </div>
      <div role="group" aria-label="Filtrar trabalhos por status" className="mt-5 flex flex-wrap gap-2">
        {JOB_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => onFilter?.(f.id)}
            className={cn(
              'min-h-11 rounded-xl px-3 text-sm font-medium transition-colors',
              (activeFilter ?? 'all') === f.id ? 'bg-primary/[0.14] text-link' : 'bg-accent/35 text-muted-foreground hover:text-foreground',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>
    </>
  );
}

export function JobsList({ initialJobs }: { initialJobs: JobDTO[] }) {
  const [jobs, setJobs] = useState(initialJobs);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  const hasActive = jobs.some((j) => isActiveStatus(j.status));
  // Só faz polling enquanto houver trabalho ativo.
  useInterval(() => void apiFetch<JobDTO[]>('/api/jobs').then(setJobs).catch(() => undefined), 2000, hasActive);

  const visible = useMemo(() => {
    const match = JOB_FILTERS.find((f) => f.id === filter)!.match;
    const q = search.trim().toLowerCase();
    return jobs.filter(
      (j) => match(j.status) && (!q || `${j.title} ${j.videoName ?? ''} ${j.product ?? ''}`.toLowerCase().includes(q)),
    );
  }, [jobs, filter, search]);

  return (
    <PageLayout
      action={
        <LinkButton href={ROUTES.newJob} variant="primary">
          <Video /> Novo trabalho
        </LinkButton>
      }
    >
      <JobsHeader search={search} onSearch={setSearch} activeFilter={filter} onFilter={setFilter} />

      {jobs.length > 0 && (
        <p role="status" className="mt-[18px] text-[13px] text-muted-foreground">
          {visible.length} {visible.length === 1 ? 'trabalho' : 'trabalhos'} nesta busca · {jobs.length} carregados
        </p>
      )}

      <div className="mt-2.5">
        {jobs.length === 0 ? (
          <EmptyState icon={<Video className="size-9" />} title="Nenhum trabalho ainda">
            Crie seu primeiro trabalho para acompanhar o progresso e abrir os arquivos da geração.
          </EmptyState>
        ) : visible.length === 0 ? (
          <EmptyState title="Nenhum trabalho encontrado">Ajuste a busca ou o filtro de status.</EmptyState>
        ) : (
          <ul className="overflow-hidden rounded-2xl bg-card">
            {visible.map((job) => (
              <li key={job.id} className="border-t border-border/40 first:border-t-0">
                <Link href={`${ROUTES.jobs}/${job.id}`} className="flex items-center px-5 py-4 transition-colors hover:bg-secondary/30">
                  <div className="min-w-0 flex-1">
                    {/* Título longo: corta com reticências e a etiqueta de status desce para a linha de baixo. */}
                    <div className="flex min-h-6 flex-wrap items-center gap-x-2 gap-y-2">
                      <p className="max-w-full truncate text-base font-semibold">{job.title}</p>
                      <JobStatusPill job={job} />
                    </div>
                    {job.kind === 'transcription' ? (
                      // Transcrição: uma linha só (fase à esquerda, progresso à direita).
                      <div className="mt-2.5 flex min-h-5 items-center justify-between gap-4 text-sm text-muted-foreground">
                        <span className="truncate">{phaseLabel(job)}</span>
                        <span className="shrink-0">{progressLabel(job)}</span>
                      </div>
                    ) : (
                      // Geração: duas linhas — a fase e, abaixo, o progresso.
                      <div className="mt-2.5 text-sm text-muted-foreground">
                        <p className="min-h-5">{phaseLabel(job)}</p>
                        <p className="min-h-5">{progressLabel(job)}</p>
                      </div>
                    )}
                    <div className={job.kind === 'transcription' ? 'mt-1' : 'mt-2'}>
                      <ProgressBar percent={progressPercent(job)} label={`Progresso de ${job.title}: ${progressLabel(job)}`} />
                    </div>
                  </div>
                  <span className="ml-4 flex shrink-0 items-center gap-1.5 text-sm font-medium text-link">
                    Abrir geração <ArrowRight className="size-4" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageLayout>
  );
}
