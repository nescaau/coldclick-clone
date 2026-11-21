'use client';

import { ArrowLeft, Ban, Download, Film, ImageIcon, RotateCcw, Trash2, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PageLayout } from '../PageLayout';
import { FORMATS, labelOf, LANGUAGES, MODELS } from '@/lib/catalog';
import { apiFetch, errorMessage, useInterval } from '@/lib/client';
import { formatProgress, isActiveStatus, overallPercent } from '@/lib/format';
import { ROUTES } from '@/lib/nav';
import type { ItemKind, JobDetailDTO, JobItemDTO } from '@/lib/types';
import { Alert, Button, Card, cn, DateText, Pill, ProgressBar, Spinner } from '../ui';
import { JobStatusPill } from './JobStatusPill';

type Filter = 'all' | ItemKind;

export function JobDetail({ initialJob }: { initialJob: JobDetailDTO }) {
  const router = useRouter();
  const [job, setJob] = useState(initialJob);
  const [filter, setFilter] = useState<Filter>('all');
  const [busy, setBusy] = useState<'cancel' | 'retry' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const active = isActiveStatus(job.status);
  useInterval(() => void apiFetch<JobDetailDTO>(`/api/jobs/${job.id}`).then(setJob).catch(() => undefined), 1500, active);

  const act = async (kind: 'cancel' | 'retry' | 'delete') => {
    if (kind === 'cancel' && !confirm('Cancelar este trabalho? Os itens já gerados são mantidos.')) return;
    if (kind === 'delete' && !confirm('Excluir este trabalho e todos os arquivos gerados? Não dá para desfazer.')) return;
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'delete') {
        await apiFetch(`/api/jobs/${job.id}`, { method: 'DELETE' });
        router.push(ROUTES.jobs);
        return;
      }
      setJob(await apiFetch<JobDetailDTO>(`/api/jobs/${job.id}/${kind}`, { method: 'POST' }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const items = job.items.filter((i) => filter === 'all' || i.kind === filter);
  const canRetry = (job.status === 'partial' || job.status === 'failed') && job.videosFailed + job.imagesFailed > 0;

  const config: Array<[string, string]> = [
    ['Vídeo de origem', job.videoName ?? '—'],
    ['Avatar', job.avatarName],
    ['Formato', labelOf(FORMATS, job.format)],
    ['Variações', String(job.variations)],
    ['Modelo', labelOf(MODELS, job.model)],
    ['Resolução', job.resolution],
    ['Idioma', labelOf(LANGUAGES, job.language)],
  ];

  return (
    <PageLayout className="space-y-8">
      <div>
        <Link href={ROUTES.jobs} className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Trabalhos
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow">Estúdio criativo · Produção</p>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="truncate text-3xl font-bold leading-10 tracking-[-0.01em]">{job.title}</h1>
              <JobStatusPill status={job.status} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Criado em <DateText iso={job.createdAt} />
              {job.finishedAt && (
                <>
                  {' '}
                  · finalizado em <DateText iso={job.finishedAt} />
                </>
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {active && (
              <Button variant="outline" className="text-destructive" onClick={() => act('cancel')} loading={busy === 'cancel'}>
                <Ban /> Cancelar
              </Button>
            )}
            {canRetry && (
              <Button variant="primary" onClick={() => act('retry')} loading={busy === 'retry'}>
                <RotateCcw /> Reexecutar falhas
              </Button>
            )}
            {!active && (
              <Button variant="destructive" onClick={() => act('delete')} loading={busy === 'delete'}>
                <Trash2 /> Excluir
              </Button>
            )}
          </div>
        </div>
      </div>

      {error && <Alert>{error}</Alert>}
      {job.error && <Alert tone="warning">{job.error}</Alert>}

      <Card className="p-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-base font-semibold">{formatProgress(job)}</p>
          <p className="text-sm text-muted-foreground">
            {job.imagesDone} de {job.variations} imagens-base · {job.generationsUsed} de até {job.maxGenerations} gerações usadas
          </p>
        </div>
        <ProgressBar percent={overallPercent(job)} label="Progresso geral do trabalho" />
        <p className="mt-3 text-xs text-muted-foreground">
          Modo de demonstração: os arquivos abaixo são <strong>placeholders</strong>. A geração real (Flow) entra na fase 2.
        </p>
      </Card>

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-base font-semibold">Arquivos gerados</h2>
          <div className="flex gap-2">
            {(
              [
                ['all', 'Todos', job.items.length],
                ['video', 'Vídeos', job.variations],
                ['image', 'Imagens-base', job.variations],
              ] as const
            ).map(([id, label, count]) => (
              <button
                key={id}
                type="button"
                onClick={() => setFilter(id)}
                className={cn(
                  'min-h-9 rounded-xl px-3 text-sm font-medium transition-colors',
                  filter === id ? 'bg-primary/[0.14] text-link' : 'bg-accent/35 text-muted-foreground hover:text-foreground',
                )}
              >
                {label} <span className="opacity-60">{count}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {items.map((item) => (
            <ItemCard key={item.id} item={item} format={job.format} />
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-base font-semibold">Configuração</h2>
        <Card className="grid gap-x-8 px-5 sm:grid-cols-2">
          {config.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 border-b border-border/40 py-3 text-sm last:border-b-0 sm:[&:nth-last-child(2)]:border-b-0">
              <span className="text-muted-foreground">{k}</span>
              <span className="truncate font-medium">{v}</span>
            </div>
          ))}
        </Card>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <TextBlock title="Copy" text={job.copyText} />
          <TextBlock title="Transcrição" badge={job.transcriptSource === 'whisper' ? 'Whisper' : job.transcriptSource === 'manual' ? 'Manual' : null} text={job.transcript} />
        </div>
      </section>
    </PageLayout>
  );
}

function TextBlock({ title, text, badge }: { title: string; text: string; badge?: string | null }) {
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {badge && <Pill>{badge}</Pill>}
      </div>
      <p className="max-h-48 overflow-y-auto whitespace-pre-wrap text-sm text-muted-foreground">{text.trim() || '—'}</p>
    </Card>
  );
}

const ASPECT: Record<string, string> = { '9:16': 'aspect-[9/16]', '1:1': 'aspect-square', '16:9': 'aspect-video' };
const ITEM_STATUS = { pending: 'Aguardando', running: 'Em andamento', done: 'Pronto', failed: 'Falhou', cancelled: 'Cancelado' } as const;

function ItemCard({ item, format }: { item: JobItemDTO; format: string }) {
  const label = `${item.kind === 'video' ? 'Vídeo' : 'Imagem-base'} ${String(item.variation).padStart(2, '0')}`;
  const Icon = item.kind === 'video' ? Film : ImageIcon;

  return (
    <div className="overflow-hidden rounded-2xl bg-card">
      <div className={cn('relative grid place-items-center bg-secondary', ASPECT[format] ?? 'aspect-square')}>
        {item.status === 'done' && item.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.url} alt={label} className="h-full w-full object-cover" loading="lazy" />
        ) : item.status === 'running' ? (
          <div className="flex flex-col items-center gap-2 text-link">
            <Spinner className="size-6" />
            <span className="text-xs">Gerando…</span>
          </div>
        ) : item.status === 'failed' ? (
          <div className="flex flex-col items-center gap-2 px-3 text-center text-destructive">
            <TriangleAlert className="size-6" />
            <span className="text-xs">{item.error ?? 'Falhou'}</span>
          </div>
        ) : (
          <Icon className="size-6 text-muted-foreground/60" />
        )}
        {item.attempts > 1 && item.status !== 'failed' && (
          <span className="absolute right-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-warning">{item.attempts}ª tentativa</span>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold">{label}</p>
          <p className="text-[11px] text-muted-foreground">{item.status === 'done' && item.isPlaceholder ? 'Placeholder' : ITEM_STATUS[item.status]}</p>
        </div>
        {item.status === 'done' && item.url && (
          <a href={item.url} download className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label={`Baixar ${label}`}>
            <Download className="size-4" />
          </a>
        )}
      </div>
    </div>
  );
}
