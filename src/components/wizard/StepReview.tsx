'use client';

import { ChevronDown, Loader2, Rocket, Video } from 'lucide-react';
import { useState } from 'react';
import { CREATIVE_FORMATS, describeAxes, IMAGE_MODELS, labelOf, MODELS, outputLanguageLabel, SCRIPT_MODES } from '@/lib/catalog';
import { ROTATION_RULES } from '@/lib/rotation';
import type { JobPreviewDTO } from '@/lib/types';
import { Alert, Button, cn, Modal } from '../ui';
import { copyLength, ctaText, outputsOf, type WizardState } from './state';

/** Resposta de POST /api/jobs/estimate. */
export type PreparedJob = JobPreviewDTO;

interface ReviewProps {
  state: WizardState;
  avatarNames: string[];
  preparing: boolean;
  error: string | null;
  onPrepare: () => void;
}

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={cn(wide && 'sm:col-span-2')}>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm font-semibold">{children}</dd>
    </div>
  );
}

/** Etapa 4 · Revisão ("Estimativa e envio"): conferência e botão "Preparar geração". */
export function StepReview({ state, avatarNames, preparing, error, onPrepare }: ReviewProps) {
  const outputs = outputsOf(state);
  const execution = `Vídeo no Google Flow · ${labelOf(IMAGE_MODELS, state.imageModel)} · ${labelOf(MODELS, state.model)} · ${state.resolution}`;

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Revisão</p>
        <h3 className="mt-1 text-xl font-bold tracking-tight">Confira antes de iniciar</h3>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          Ao iniciar, o Antigravity prepara os prompts automaticamente e calcula as chamadas antes de enviar o lote ao Flow.
        </p>
      </div>

      <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
        <Field label="Vídeo de referência">{state.video?.name}</Field>
        <Field label="Produto">{state.product ?? 'Sem produto'}</Field>
        <Field label="Formato criativo">{labelOf(CREATIVE_FORMATS, state.creativeFormat)}</Field>
        <Field label="Idioma de saída">{outputLanguageLabel(state.outputLanguage)}</Field>
        <Field label="Modo do roteiro">{labelOf(SCRIPT_MODES, state.scriptMode)}</Field>
        <Field label="Avatares">{avatarNames.join(', ')}</Field>
        <Field label="Saídas">
          {outputs} {outputs === 1 ? 'saída' : 'saídas'}
        </Field>
        <Field label="Eixos selecionados">{describeAxes(state.axes)}</Field>
        <Field label="Chamada para ação (CTA)">{ctaText(state) || 'Sem CTA'}</Field>
        <Field label="Execução">{execution}</Field>
        <Field label="Transcrição" wide>
          {copyLength(state).toLocaleString('pt-BR')} caracteres informados
        </Field>
      </dl>

      {error && <Alert>{error}</Alert>}

      <Button variant="primary" className="w-full" onClick={onPrepare} disabled={preparing} aria-label={preparing ? 'Preparando prompts com Antigravity' : 'Preparar geração automaticamente'}>
        {preparing ? <Loader2 className="animate-spin" /> : <Video />}
        {preparing ? 'Preparando prompts com Antigravity…' : 'Preparar geração'}
      </Button>
    </div>
  );
}

/** Modal "Confirmar gerações reais no Flow" — última checagem antes de enfileirar o trabalho. */
export function ConfirmModal({
  open,
  state,
  prepared,
  submitting,
  error,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  state: WizardState;
  prepared: PreparedJob | null;
  submitting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [details, setDetails] = useState(false);
  if (!prepared) return null;
  const { estimate, eligibleAccounts, variations } = prepared;

  const columns: Array<[string, string, string?]> = [
    ['Vídeos', String(estimate.videos)],
    ['Imagens-base', String(estimate.baseImages)],
    [
      'Rotação',
      `${eligibleAccounts} ${eligibleAccounts === 1 ? 'conta' : 'contas'}`,
      `mín. ${ROTATION_RULES.minCredits} créditos · até ${ROTATION_RULES.maxVideosPerCycle} vídeos e ${ROTATION_RULES.maxImagesPerCycle} imagens por conta`,
    ],
  ];

  return (
    <Modal open={open} onClose={submitting ? () => undefined : onCancel} title="Confirmar gerações reais no Flow">
      <div className="space-y-5">
        <div className="flex items-center gap-5">
          <div className="grid size-24 shrink-0 place-items-center rounded-full bg-primary/[0.14] text-center text-link ring-2 ring-primary/40" aria-label={`Até ${estimate.maxGenerations} gerações`}>
            <span>
              <span className="block text-xs font-semibold uppercase tracking-wide">Até</span>
              <span className="block text-3xl font-bold leading-8">{estimate.maxGenerations}</span>
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            gerações no Google Flow para {variations} {variations === 1 ? 'saída' : 'saídas'}, contando a folga de {estimate.retryAllowance} para refazer o que falhar. O custo em créditos é descontado das contas da rotação.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {columns.map(([label, value, sub]) => (
            <div key={label} className="rounded-xl bg-inset p-3">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-lg font-bold">{value}</p>
              {sub && <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{sub}</p>}
            </div>
          ))}
        </div>

        {eligibleAccounts === 0 && <Alert tone="warning">Nenhuma conta Flow elegível na rotação. Nesta versão a geração é simulada, então o trabalho roda mesmo assim.</Alert>}

        <div>
          <p className="mb-2 text-sm font-semibold">O que será enviado ao Google Flow</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Prompts preparados com as suas chaves Gemini, a partir da copy, do formato criativo e das variações.</li>
            <li>{prepared.avatarNames.join(', ')}: {state.avatarIds.length ? 'fotos de referência de cada avatar.' : 'quadro original do vídeo, mantendo a pessoa.'}</li>
            <li>Uma imagem-base e um vídeo por saída, com {labelOf(IMAGE_MODELS, state.imageModel)} e {labelOf(MODELS, state.model)} em {state.resolution}.</li>
          </ul>
        </div>

        <div>
          <button type="button" aria-expanded={details} onClick={() => setDetails((v) => !v)} className="flex items-center gap-1 text-sm font-medium text-link hover:underline">
            Ver configuração e cálculo detalhado <ChevronDown className={cn('size-4 transition-transform', details && 'rotate-180')} />
          </button>
          {details && (
            <div className="mt-3 space-y-2 rounded-xl bg-inset p-4 text-sm text-muted-foreground">
              <p>
                <span className="font-semibold text-foreground">Cálculo:</span> {estimate.videos} vídeos + {estimate.baseImages} imagens-base = {estimate.videos + estimate.baseImages} gerações, mais folga de {estimate.retryAllowance} para novas tentativas = até {estimate.maxGenerations}.
              </p>
              <p>
                <span className="font-semibold text-foreground">Configuração:</span> {state.video?.name} · {labelOf(CREATIVE_FORMATS, state.creativeFormat)} · {outputLanguageLabel(state.outputLanguage)} · {variations} {variations === 1 ? 'saída' : 'saídas'}.
              </p>
            </div>
          )}
        </div>

        <p className="text-xs text-muted-foreground">Nesta fase a geração é simulada: nenhum crédito do Flow é usado e os arquivos são placeholders.</p>
        {error && <Alert>{error}</Alert>}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="outline" onClick={onCancel} disabled={submitting}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={onConfirm} loading={submitting}>
            <Rocket /> Confirmar e iniciar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
