'use client';

import { ArrowLeft, ChevronRight, Library, Rocket } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PageLayout } from '../PageLayout';
import { apiFetch, errorMessage, jsonInit } from '@/lib/client';
import { formatBinaryBytes } from '@/lib/format';
import { ROUTES } from '@/lib/nav';
import type { AvatarDTO, JobDetailDTO, StorageUsageDTO, VideoDTO } from '@/lib/types';
import { Button, Card, cn, LinkButton, ProgressBar } from '../ui';
import { INITIAL_STATE, STEPS, firstBlockedIndex, stepBlocker, type FlowGate, type WizardState } from './state';
import { StepPersonalize } from './StepPersonalize';
import { ConfirmModal, StepReview } from './StepReview';
import { StepScript } from './StepScript';
import { StepVideo } from './StepVideo';
import { SummaryPanel } from './SummaryPanel';
import { Check } from 'lucide-react';

interface Props {
  initialVideos: VideoDTO[];
  avatars: AvatarDTO[];
  whisperConfigured: boolean;
  storage: StorageUsageDTO;
  /** Chrome pareado e online. */
  flowConnected: boolean;
  /** A Revisão só libera com o Flow conectado (COLDCLICK_REQUIRE_FLOW=1). */
  requireFlowConnection: boolean;
  eligibleAccounts: number;
}

export function NewJobWizard({ initialVideos, avatars, whisperConfigured, storage, flowConnected, requireFlowConnection, eligibleAccounts }: Props) {
  const router = useRouter();
  const [stepIndex, setStepIndex] = useState(0);
  const [state, setState] = useState<WizardState>(INITIAL_STATE);
  const [videos, setVideos] = useState(initialVideos);
  const [usedBytes, setUsedBytes] = useState(storage.usedBytes);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const flow: FlowGate = { required: requireFlowConnection, connected: flowConnected };
  const step = STEPS[stepIndex];
  const blocker = stepBlocker(step.id, state, flow);
  const patch = (p: Partial<WizardState>) => setState((s) => ({ ...s, ...p }));
  const avatar = avatars.find((a) => a.id === state.avatarId) ?? null;
  const defaultTitle = state.video?.name ?? 'Novo vídeo';
  const isLast = stepIndex === STEPS.length - 1;

  /** Ao escolher outro vídeo, a copy do anterior não vale mais; reaproveita a transcrição salva, se houver. */
  const selectVideo = (video: VideoDTO | null) => {
    if (video?.id === state.video?.id) return;
    patch({ video, transcript: video?.transcript ?? '', transcriptSource: video?.transcript ? 'whisper' : 'none', copyText: video?.transcript ?? '' });
  };

  /** Só entra em uma etapa se todas as anteriores estiverem válidas. */
  const canEnter = (index: number) => index <= stepIndex || firstBlockedIndex(index, state, flow) === -1;
  const reviewIndex = STEPS.length - 1;
  const canReview = firstBlockedIndex(reviewIndex, state, flow) === -1;

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const job = await apiFetch<JobDetailDTO>(
        '/api/jobs',
        jsonInit('POST', {
          title: state.title.trim() || undefined,
          videoId: state.video!.id,
          avatarId: state.avatarId,
          transcript: state.transcript,
          transcriptSource: state.transcriptSource,
          copyText: state.copyText,
          language: state.language,
          format: state.format,
          variations: state.variations,
          model: state.model,
          resolution: state.resolution,
        }),
      );
      router.push(`${ROUTES.jobs}/${job.id}`);
    } catch (e) {
      setError(errorMessage(e));
      setSubmitting(false);
    }
  };

  const percent = Math.min(100, Math.round((usedBytes / storage.quotaBytes) * 100));
  const available = Math.max(0, storage.quotaBytes - usedBytes);

  return (
    <PageLayout
      action={
        <LinkButton href={ROUTES.avatars} variant="outline">
          <Library /> Biblioteca de avatares
        </LinkButton>
      }
      className="space-y-5"
    >
      {/* Conexão do Google Flow */}
      <Card className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div>
          <p className="text-sm font-semibold">Conexão do Google Flow</p>
          <p className="mt-1 text-sm text-muted-foreground">A mesma conexão transcreve o vídeo e produz as imagens e os clipes.</p>
        </div>
        <div className="flex items-center gap-4">
          <span role="status" className={cn('inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium', flowConnected ? 'bg-success/[0.14] text-success' : 'bg-secondary text-muted-foreground')}>
            <span className={cn('size-2 rounded-full', flowConnected ? 'bg-success' : 'bg-muted-foreground')} />
            {flowConnected ? 'Conectado' : 'Desconectado'}
          </span>
          <Link href={ROUTES.flowAccounts} className="text-sm font-semibold hover:underline">
            Gerenciar contas Flow
          </Link>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-base font-semibold">Nova geração de vídeo</h2>
        <p className="mt-3 text-sm text-muted-foreground">Envie um vídeo, escreva a copy ou transcreva pelo Flow quando quiser. Depois, escolha avatares e variações.</p>

        {/* Armazenamento da conta */}
        <section aria-label="Armazenamento da conta" className="mt-6">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold">Armazenamento da conta</h3>
            <p className="text-xs text-muted-foreground">
              {formatBinaryBytes(usedBytes)} de {formatBinaryBytes(storage.quotaBytes)} usados · {formatBinaryBytes(available)} disponíveis · {percent}% usado
            </p>
          </div>
          <ProgressBar percent={percent} label={`Uso do armazenamento: ${percent}%`} />
          <p className="mt-2.5 text-xs text-muted-foreground">Vídeos enviados e pacotes gerados consomem o espaço total da sua conta.</p>
        </section>

        <form className="mt-[22px]" onSubmit={(e) => e.preventDefault()}>
          {/* Etapas */}
          <ol aria-label="Etapas para criar um trabalho" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => {
              const current = i === stepIndex;
              const hint = stepBlocker(s.id, state, flow);
              // Check quando a etapa já está válida (inclui a Personalização, válida por padrão: "Pessoa original").
              const done = !current && s.id !== 'review' && hint === null;
              const locked = !canEnter(i);
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => setStepIndex(i)}
                    aria-current={current ? 'step' : undefined}
                    aria-label={`${s.label} ${s.hint}${hint && !current ? ` · ${hint}` : ''}`}
                    className={cn(
                      'flex min-h-14 w-full min-w-0 items-center gap-2.5 rounded-xl px-3 text-left transition-colors disabled:cursor-not-allowed',
                      current ? 'bg-primary/[0.14] text-link' : 'bg-accent/30 text-muted-foreground enabled:hover:bg-accent/50',
                    )}
                  >
                    <span className={cn('grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold', current ? 'text-link' : 'bg-secondary/60')}>
                      {done ? <Check className="size-3.5" /> : i + 1}
                    </span>
                    <span className="min-w-0">
                      <span className={cn('block truncate text-sm font-semibold', current ? 'text-link' : 'text-muted-foreground')}>{s.label}</span>
                      <span className="block truncate text-xs text-muted-foreground">{s.hint}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>

          <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_272px]">
            <div className="min-w-0">
              <div className="min-h-[18rem]">
                {step.id === 'video' && (
                  <StepVideo videos={videos} selected={state.video} onVideosChange={setVideos} onSelect={selectVideo} onUploaded={(bytes) => setUsedBytes((u) => Math.max(0, u + bytes))} />
                )}
                {step.id === 'script' && state.video && (
                  <StepScript
                    state={state}
                    whisperConfigured={whisperConfigured}
                    onChange={patch}
                    onVideoUpdate={(v) => {
                      setVideos((list) => list.map((x) => (x.id === v.id ? v : x)));
                      patch({ video: v });
                    }}
                  />
                )}
                {step.id === 'personalize' && <StepPersonalize state={state} avatars={avatars} onChange={patch} />}
                {step.id === 'review' && <StepReview state={state} avatar={avatar} />}
              </div>

              {/* Rodapé: Etapa N de 4 + Continuar */}
              <div className="mt-6 flex items-center gap-3">
                {stepIndex > 0 && (
                  <Button variant="ghost" onClick={() => setStepIndex((i) => i - 1)} disabled={submitting}>
                    <ArrowLeft /> Voltar
                  </Button>
                )}
                <p className="flex-1 text-center text-xs text-muted-foreground">
                  Etapa {stepIndex + 1} de {STEPS.length}
                </p>
                {isLast ? (
                  <Button variant="primary" onClick={() => setConfirming(true)} disabled={Boolean(blocker)}>
                    <Rocket /> Iniciar geração
                  </Button>
                ) : (
                  <Button variant="primary" onClick={() => setStepIndex((i) => i + 1)} disabled={Boolean(blocker)}>
                    Continuar <ChevronRight />
                  </Button>
                )}
              </div>
              {blocker && (
                <p role="status" className="mt-3 text-right text-xs text-muted-foreground">
                  {blocker}
                </p>
              )}
            </div>

            <SummaryPanel state={state} avatar={avatar} defaultTitle={defaultTitle} canReview={canReview} onChange={patch} onReview={() => setStepIndex(reviewIndex)} />
          </div>
        </form>
      </Card>

      <ConfirmModal
        open={confirming}
        state={state}
        avatar={avatar}
        eligibleAccounts={eligibleAccounts}
        submitting={submitting}
        error={error}
        onCancel={() => {
          setConfirming(false);
          setError(null);
        }}
        onConfirm={submit}
      />
    </PageLayout>
  );
}
