'use client';

import { Check, ChevronLeft, ChevronRight, Library } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PageLayout } from '../PageLayout';
import { AvatarFormModal } from '../avatars/AvatarFormModal';
import { apiFetch, errorMessage, jsonInit } from '@/lib/client';
import { formatBinaryBytes } from '@/lib/format';
import { ROUTES } from '@/lib/nav';
import type { AvatarDTO, JobDetailDTO, JobPreviewDTO, StorageUsageDTO, VideoDTO } from '@/lib/types';
import { Button, Card, cn, LinkButton, ProgressBar } from '../ui';
import { INITIAL_STATE, STEPS, ctaText, firstBlockedIndex, fullCopy, lockedHint, stepBlocker, type FlowGate, type WizardState } from './state';
import { StepPersonalize } from './StepPersonalize';
import { ConfirmModal, StepReview } from './StepReview';
import { StepScript } from './StepScript';
import { StepVideo } from './StepVideo';
import { SummaryPanel } from './SummaryPanel';

interface Props {
  initialVideos: VideoDTO[];
  initialAvatars: AvatarDTO[];
  products: string[];
  /** O serviço de transcrição (Whisper) tem chave configurada. */
  transcriptionReady: boolean;
  storage: StorageUsageDTO;
  /** Chrome pareado e online. */
  flowConnected: boolean;
  /** A Revisão só libera com o Flow conectado (COLDCLICK_REQUIRE_FLOW=1). */
  requireFlowConnection: boolean;
}

const stripExtension = (name: string) => name.replace(/\.[^.]+$/, '');

/** Corpo comum de POST /api/jobs/estimate e POST /api/jobs. */
function buildPayload(s: WizardState) {
  return {
    title: s.title.trim() || undefined,
    videoId: s.video!.id,
    avatarIds: s.avatarIds,
    product: s.product,
    creativeFormat: s.creativeFormat,
    scriptMode: s.scriptMode,
    outputLanguage: s.outputLanguage,
    axes: s.axes,
    imageModel: s.imageModel,
    cta: ctaText(s),
    transcript: s.transcript,
    transcriptSource: s.transcriptSource,
    scenes: s.scenes,
    copyText: fullCopy(s),
    model: s.model,
    resolution: s.resolution,
  };
}

export function NewJobWizard({ initialVideos, initialAvatars, products, transcriptionReady, storage, flowConnected, requireFlowConnection }: Props) {
  const router = useRouter();
  const [stepIndex, setStepIndex] = useState(0);
  const [state, setState] = useState<WizardState>(INITIAL_STATE);
  const [videos, setVideos] = useState(initialVideos);
  const [avatars, setAvatars] = useState(initialAvatars);
  const [usedBytes, setUsedBytes] = useState(storage.usedBytes);
  const [newAvatarOpen, setNewAvatarOpen] = useState(false);
  const [prepared, setPrepared] = useState<JobPreviewDTO | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const flow: FlowGate = { required: requireFlowConnection, connected: flowConnected };
  const step = STEPS[stepIndex];
  const blocker = stepBlocker(step.id, state, flow);
  const patch = (p: Partial<WizardState>) => setState((s) => ({ ...s, ...p }));
  const selectedAvatars = state.avatarIds.map((id) => avatars.find((a) => a.id === id)).filter((a): a is AvatarDTO => Boolean(a));
  const avatarNames = selectedAvatars.length ? selectedAvatars.map((a) => a.name) : ['Pessoa original'];
  const defaultTitle = state.video ? stripExtension(state.video.name) : 'Novo vídeo';
  const reviewIndex = STEPS.length - 1;
  const canEnter = (index: number) => index <= stepIndex || firstBlockedIndex(index, state, flow) === -1;
  const canReview = firstBlockedIndex(reviewIndex, state, flow) === -1;

  /** Ao escolher outro vídeo, a copy do anterior não vale mais; reaproveita as cenas já transcritas, se houver. */
  const selectVideo = (video: VideoDTO | null) => {
    if (video?.id === state.video?.id) return;
    const scenes = video?.transcriptScenes ?? [];
    patch({
      video,
      scenes,
      transcript: video?.transcript ?? '',
      transcriptSource: video?.transcript ? 'whisper' : 'none',
      copyText: '',
    });
  };

  const prepare = async () => {
    setPreparing(true);
    setError(null);
    try {
      setPrepared(await apiFetch<JobPreviewDTO>('/api/jobs/estimate', jsonInit('POST', buildPayload(state))));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPreparing(false);
    }
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const job = await apiFetch<JobDetailDTO>('/api/jobs', jsonInit('POST', buildPayload(state)));
      router.push(`${ROUTES.jobs}/${job.id}`);
    } catch (e) {
      setError(errorMessage(e));
      setSubmitting(false);
    }
  };

  const onAvatarCreated = async (saved: AvatarDTO) => {
    setNewAvatarOpen(false);
    try {
      setAvatars(await apiFetch<AvatarDTO[]>('/api/avatars'));
      setState((s) => ({ ...s, avatarIds: [...s.avatarIds, saved.id] }));
    } catch {
      /* a lista é recarregada na próxima visita; a seleção continua válida */
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
              const lock = locked ? lockedHint(s.id, flow) : null;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => setStepIndex(i)}
                    aria-current={current ? 'step' : undefined}
                    aria-label={`${s.label} ${s.hint}${lock ? ` · ${lock}` : ''}`}
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
                    products={products}
                    transcriptionReady={transcriptionReady}
                    onChange={patch}
                    onVideoUpdate={(v) => {
                      setVideos((list) => list.map((x) => (x.id === v.id ? v : x)));
                      patch({ video: v });
                    }}
                  />
                )}
                {step.id === 'personalize' && <StepPersonalize state={state} avatars={avatars} onChange={patch} onNewAvatar={() => setNewAvatarOpen(true)} />}
                {step.id === 'review' && <StepReview state={state} avatarNames={avatarNames} preparing={preparing} error={prepared ? null : error} onPrepare={prepare} />}
              </div>

              {/* Rodapé: Voltar · Etapa N de 4 · Continuar */}
              <div className="mt-6 flex items-center gap-3">
                {stepIndex > 0 && (
                  <Button variant="outline" onClick={() => setStepIndex((i) => i - 1)} disabled={submitting || preparing}>
                    <ChevronLeft /> Voltar
                  </Button>
                )}
                <p className="flex-1 text-center text-xs text-muted-foreground">
                  Etapa {stepIndex + 1} de {STEPS.length}
                </p>
                {stepIndex < reviewIndex && (
                  <Button variant="primary" onClick={() => setStepIndex((i) => i + 1)} disabled={Boolean(blocker)}>
                    {step.id === 'personalize' ? 'Revisar trabalho' : 'Continuar'} <ChevronRight />
                  </Button>
                )}
              </div>
              {blocker && (
                <p role="status" className="mt-3 text-right text-xs text-muted-foreground">
                  {blocker}
                </p>
              )}
            </div>

            <SummaryPanel
              state={state}
              avatarNames={avatarNames}
              defaultTitle={defaultTitle}
              showAvatarBlock={step.id === 'personalize'}
              canReview={canReview}
              onChange={patch}
              onReview={() => setStepIndex(reviewIndex)}
            />
          </div>
        </form>
      </Card>

      <ConfirmModal
        open={prepared !== null}
        state={state}
        prepared={prepared}
        submitting={submitting}
        error={error}
        onCancel={() => {
          setPrepared(null);
          setError(null);
        }}
        onConfirm={submit}
      />

      <AvatarFormModal key={newAvatarOpen ? 'open' : 'closed'} avatar={null} open={newAvatarOpen} onClose={() => setNewAvatarOpen(false)} onSaved={onAvatarCreated} />
    </PageLayout>
  );
}
