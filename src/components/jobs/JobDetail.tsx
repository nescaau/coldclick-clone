'use client';

import { ArrowLeft, Ban, ChevronDown, Clapperboard, Download, Film, ImageIcon, RotateCcw, Trash2, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PageLayout } from '../PageLayout';
import {
  AXES,
  CREATIVE_FORMATS,
  IMAGE_MODELS,
  labelOf,
  MODELS,
  outputLanguageLabel,
  SCRIPT_MODES,
} from '@/lib/catalog';
import { apiFetch, errorMessage, useInterval } from '@/lib/client';
import { formatElapsed, isActiveStatus, phaseLabel, progressLabel, progressPercent } from '@/lib/format';
import { ROUTES } from '@/lib/nav';
import { speechSeconds } from '@/lib/scenes';
import type { ItemKind, JobDetailDTO, JobItemDTO } from '@/lib/types';
import { Alert, Button, Card, cn, ConfirmDialog, DateText, LinkButton, ProgressBar, Spinner } from '../ui';
import { JobStatusPill } from './JobStatusPill';

type Filter = 'all' | ItemKind;

/** Descrição da "Etapa atual", conforme o tipo e o estado do trabalho. */
function stageDescription(job: JobDetailDTO): string {
  if (job.status === 'failed' && job.error) return job.error;
  if (job.kind === 'transcription') {
    return job.status === 'completed'
      ? 'Áudio transcrito pelo Google Flow com tempos por palavra. Revise a copy antes de criar a prévia.'
      : 'Transcrevendo o áudio e separando as falas em cenas…';
  }
  if (job.status === 'cancelled') return 'Trabalho cancelado. Os itens já gerados foram mantidos.';
  return 'Modo de demonstração: os arquivos são placeholders. A geração real (Flow) entra na próxima fase.';
}

export function JobDetail({ initialJob }: { initialJob: JobDetailDTO }) {
  const router = useRouter();
  const [job, setJob] = useState(initialJob);
  const [filter, setFilter] = useState<Filter>('all');
  const [busy, setBusy] = useState<'cancel' | 'retry' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const [showEvents, setShowEvents] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const active = isActiveStatus(job.status);
  useInterval(() => void apiFetch<JobDetailDTO>(`/api/jobs/${job.id}`).then(setJob).catch(() => undefined), 1500, active);

  const isTranscription = job.kind === 'transcription';
  const failedItems = job.videosFailed + job.imagesFailed;
  const failures = isTranscription ? (job.status === 'failed' ? 1 : 0) : failedItems;

  const act = async (kind: 'cancel' | 'retry' | 'delete') => {
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
      setConfirmDelete(false);
    }
  };

  const items = job.items.filter((i) => filter === 'all' || i.kind === filter);
  const canRetry = !isTranscription && (job.status === 'partial' || job.status === 'failed') && failedItems > 0;

  const stats: Array<{ label: string; value: number; sub: string }> = isTranscription
    ? [
        { label: 'Clipes demonstrativos', value: 0, sub: 'nenhum clipe gerado' },
        { label: 'Imagens demonstrativas', value: 0, sub: 'nenhuma imagem gerada' },
        { label: 'Etapas com falha', value: failures, sub: failures ? 'falha registrada' : 'nenhuma falha registrada' },
      ]
    : [
        { label: 'Vídeos gerados', value: job.videosDone, sub: job.videosDone ? `de ${job.variations} planejados` : 'nenhum vídeo gerado' },
        { label: 'Imagens-base geradas', value: job.imagesDone, sub: job.imagesDone ? `de ${job.variations} planejadas` : 'nenhuma imagem gerada' },
        { label: 'Etapas com falha', value: failedItems, sub: failedItems ? `${job.failedAttempts} tentativas falharam` : 'nenhuma falha registrada' },
      ];

  return (
    <PageLayout
      action={
        <LinkButton href={ROUTES.newJob} variant="primary">
          <Clapperboard /> Novo trabalho
        </LinkButton>
      }
      className="space-y-5"
    >
      <Link href={ROUTES.jobs} className="inline-flex items-center gap-2 text-sm font-medium hover:underline">
        <ArrowLeft className="size-4" /> Voltar para trabalhos
      </Link>

      <div>
        <p className="eyebrow">Detalhes do trabalho</p>
        <h1 className="mt-1 break-words text-[28px] font-bold leading-9 tracking-[-0.01em]">{job.title}</h1>
      </div>

      {error && <Alert>{error}</Alert>}

      <Card className="space-y-5 p-5" aria-label="Execução e resultados">
        <h2 className="text-base font-semibold">Execução e resultados</h2>

        <section className="rounded-2xl bg-inset p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="eyebrow">Trabalho</p>
              <h3 className="mt-1 break-words text-lg font-semibold">{job.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {job.product ?? 'Sem produto'} · Criado em <DateText iso={job.createdAt} seconds />
              </p>
            </div>
            <JobStatusPill job={job} />
          </div>

          <div role="group" aria-label="Progresso do trabalho" className="mt-5 space-y-3 rounded-xl bg-background/50 p-4">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-xs text-muted-foreground">Etapa atual</p>
                <p className="font-semibold">{phaseLabel(job)}</p>
              </div>
              <p role="status" className="text-sm text-muted-foreground">
                {progressLabel(job)}
              </p>
            </div>
            <ProgressBar percent={progressPercent(job)} label={`${phaseLabel(job)}: ${progressLabel(job)}`} />
            <p className="text-sm leading-6 text-muted-foreground">{stageDescription(job)}</p>
            <ul className="flex items-baseline gap-1 text-sm text-muted-foreground">
              <li>Tempo decorrido</li>
              <li className="font-semibold text-foreground">{formatElapsed(job.elapsedSec)}</li>
            </ul>
          </div>
        </section>

        <div role="group" aria-label="Resumo da produção" className="grid gap-3 sm:grid-cols-3">
          {stats.map((s) => (
            <div key={s.label} className="rounded-2xl bg-inset p-4">
              <p className="text-sm text-muted-foreground">{s.label}</p>
              <p className="mt-1.5 text-xl font-bold">{s.value}</p>
              <p className="mt-1 text-sm text-muted-foreground">{s.sub}</p>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <button type="button" aria-expanded={showTranscript} onClick={() => setShowTranscript((v) => !v)} className="flex items-center gap-2 px-3 py-2 text-sm font-medium hover:text-link">
            Ver transcrição <ChevronDown className={cn('size-4 transition-transform', showTranscript && 'rotate-180')} />
          </button>
          {showTranscript && <TranscriptView job={job} />}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
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
          {(!active || isTranscription) && (
            <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2 /> {isTranscription ? 'Excluir transcrição' : 'Excluir trabalho'}
            </Button>
          )}
        </div>

        <div className="rounded-2xl bg-inset">
          <button type="button" aria-expanded={showEvents} onClick={() => setShowEvents((v) => !v)} className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold">
            <span>
              Etapas registradas · <span className="tabular-nums">{job.events.length}</span>
            </span>
            <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', showEvents && 'rotate-180')} />
          </button>
          {showEvents && (
            <ol className="space-y-2 border-t border-border/40 px-4 py-3">
              {job.events.map((e) => (
                <li key={e.id} className="flex items-start justify-between gap-4 text-sm">
                  <span className={cn(e.status === 'failed' && 'text-destructive')}>{e.label}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    <DateText iso={e.createdAt} seconds />
                  </span>
                </li>
              ))}
              {job.events.length === 0 && <li className="text-sm text-muted-foreground">Nenhuma etapa registrada.</li>}
            </ol>
          )}
        </div>
      </Card>

      {!isTranscription && (
        <>
          <GalleryCard job={job} items={items} filter={filter} onFilter={setFilter} />
          <ConfigCard job={job} />
        </>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title={isTranscription ? 'Excluir esta transcrição?' : 'Excluir este trabalho?'}
        cancelLabel="Manter"
        confirmLabel={isTranscription ? 'Excluir transcrição' : 'Excluir trabalho'}
        tone="danger"
        loading={busy === 'delete'}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => act('delete')}
      >
        <p>{isTranscription ? 'A transcrição e as etapas registradas serão removidas.' : 'O trabalho e todos os arquivos gerados serão removidos. Não dá para desfazer.'}</p>
      </ConfirmDialog>
    </PageLayout>
  );
}

/** Conteúdo de "Ver transcrição": cenas com tempos (ou a copy inteira, se não houver cenas). */
function TranscriptView({ job }: { job: JobDetailDTO }) {
  if (job.scenes.length === 0) {
    return (
      <p className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-xl bg-inset p-4 text-sm leading-6 text-muted-foreground">
        {(job.copyText || job.transcript).trim() || 'Sem transcrição.'}
      </p>
    );
  }
  return (
    <ol className="space-y-2">
      {job.scenes.map((s) => (
        <li key={s.index} className="rounded-xl bg-inset p-4">
          <div className="mb-1 flex items-center justify-between gap-3 text-sm">
            <span className="font-semibold">Cena {s.index}</span>
            <span className="text-xs text-muted-foreground">
              {s.start}–{s.end} s · fala {speechSeconds(s)} s · clipe até 8 s
            </span>
          </div>
          <p className="text-sm leading-6 text-muted-foreground">{s.text}</p>
        </li>
      ))}
    </ol>
  );
}

const FILTERS = (job: JobDetailDTO) =>
  [
    ['all', 'Todos', job.items.length],
    ['video', 'Vídeos', job.variations],
    ['image', 'Imagens-base', job.variations],
  ] as const;

function GalleryCard({ job, items, filter, onFilter }: { job: JobDetailDTO; items: JobItemDTO[]; filter: Filter; onFilter: (f: Filter) => void }) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Arquivos gerados</h2>
        <div className="flex gap-2">
          {FILTERS(job).map(([id, label, count]) => (
            <button
              key={id}
              type="button"
              onClick={() => onFilter(id)}
              className={cn('min-h-9 rounded-xl px-3 text-sm font-medium transition-colors', filter === id ? 'bg-primary/[0.14] text-link' : 'bg-accent/35 text-muted-foreground hover:text-foreground')}
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
    </Card>
  );
}

function ConfigCard({ job }: { job: JobDetailDTO }) {
  const axes = AXES.map((a) => `${a.label}: ${job.axes[a.id].mode === 'original' ? 'original' : job.axes[a.id].value}`).join(' · ');
  const rows: Array<[string, string]> = [
    ['Vídeo de referência', job.videoName ?? '—'],
    ['Produto', job.product ?? 'Sem produto'],
    ['Formato criativo', labelOf(CREATIVE_FORMATS, job.creativeFormat)],
    ['Idioma de saída', outputLanguageLabel(job.language)],
    ['Modo do roteiro', labelOf(SCRIPT_MODES, job.scriptMode)],
    ['Avatares', job.avatarName],
    ['Saídas', `${job.variations} ${job.variations === 1 ? 'saída' : 'saídas'}`],
    ['Eixos selecionados', axes],
    ['Chamada para ação (CTA)', job.cta || 'Sem CTA'],
    ['Execução', `${labelOf(IMAGE_MODELS, job.imageModel)} · ${labelOf(MODELS, job.model)} · ${job.resolution}`],
  ];
  return (
    <Card className="p-5">
      <h2 className="mb-4 text-base font-semibold">Configuração</h2>
      <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <ul key={k}>
            <li className="text-sm text-muted-foreground">{k}</li>
            <li className="mt-0.5 break-words text-sm font-semibold">{v}</li>
          </ul>
        ))}
      </div>
      <div className="mt-5">
        <p className="mb-2 text-sm font-semibold">Copy</p>
        <p className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-xl bg-inset p-4 text-sm leading-6 text-muted-foreground">{job.copyText.trim() || '—'}</p>
      </div>
    </Card>
  );
}

const ASPECT: Record<string, string> = { '9:16': 'aspect-[9/16]', '1:1': 'aspect-square', '16:9': 'aspect-video' };
const ITEM_STATUS = { pending: 'Aguardando', running: 'Em andamento', done: 'Pronto', failed: 'Falhou', cancelled: 'Cancelado' } as const;

function ItemCard({ item, format }: { item: JobItemDTO; format: string }) {
  const label = `${item.kind === 'video' ? 'Vídeo' : 'Imagem-base'} ${String(item.variation).padStart(2, '0')}`;
  const Icon = item.kind === 'video' ? Film : ImageIcon;

  return (
    <div className="overflow-hidden rounded-2xl bg-inset">
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
