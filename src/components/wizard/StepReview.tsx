'use client';

import { ChevronDown, Rocket, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { FORMATS, labelOf, LANGUAGES, MODELS } from '@/lib/catalog';
import { estimateGenerations } from '@/lib/estimate';
import { formatBytes, formatDuration } from '@/lib/format';
import { ROTATION_RULES } from '@/lib/rotation';
import type { AvatarDTO } from '@/lib/types';
import { Alert, Button, cn, Modal } from '../ui';
import type { WizardState } from './state';

const preview = (text: string) => (text.length > 160 ? `${text.slice(0, 160)}…` : text);

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 border-b border-border/40 py-2.5 text-sm last:border-b-0">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right font-semibold">{children}</dd>
    </div>
  );
}

/** Etapa 4 · Revisão ("Estimativa e envio"): conferência antes de iniciar. */
export function StepReview({ state, avatar }: { state: WizardState; avatar: AvatarDTO | null }) {
  const est = estimateGenerations(state.variations);
  const video = state.video!;
  return (
    <div className="space-y-5">
      <div>
        <p className="eyebrow">Revisão</p>
        <h3 className="text-xl font-bold tracking-tight">Confira antes de iniciar</h3>
      </div>

      <div className="flex items-start gap-3 rounded-2xl border border-primary/40 bg-primary/[0.08] p-5">
        <Sparkles className="mt-0.5 size-5 shrink-0 text-link" />
        <div>
          <p className="text-base font-semibold">{est.label}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Inclui uma folga de {est.retryAllowance} gerações para refazer itens que falharem. A folga só é usada se houver falhas.
          </p>
        </div>
      </div>

      <dl className="rounded-2xl bg-inset px-5">
        <Row label="Vídeo de referência">
          <span className="block truncate">{video.name}</span>
          <span className="text-xs font-normal text-muted-foreground">
            {formatBytes(video.sizeBytes)} · {formatDuration(video.durationSec)}
          </span>
        </Row>
        <Row label="Idioma">{labelOf(LANGUAGES, state.language)}</Row>
        <Row label="Copy">
          <span className="block max-w-md text-xs font-normal text-muted-foreground">{preview(state.copyText)}</span>
        </Row>
        <Row label="Avatares">{avatar?.name ?? 'Pessoa original'}</Row>
        <Row label="Formato">{labelOf(FORMATS, state.format)}</Row>
        <Row label="Saídas">
          {state.variations} {state.variations === 1 ? 'variação' : 'variações'}
        </Row>
        <Row label="Modelo de vídeo">{labelOf(MODELS, state.model)}</Row>
        <Row label="Resolução do vídeo">{state.resolution}</Row>
      </dl>
    </div>
  );
}

/** Modal "Confirmar gerações reais no Flow" — última checagem antes de enfileirar o trabalho. */
export function ConfirmModal({ open, state, avatar, eligibleAccounts, submitting, error, onCancel, onConfirm }: {
  open: boolean;
  state: WizardState;
  avatar: AvatarDTO | null;
  eligibleAccounts: number;
  submitting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [details, setDetails] = useState(false);
  const est = estimateGenerations(state.variations);
  const columns: Array<[string, string, string?]> = [
    ['Vídeos', String(est.videos)],
    ['Imagens-base', String(est.baseImages)],
    ['Rotação', `${eligibleAccounts} ${eligibleAccounts === 1 ? 'conta' : 'contas'}`, `mín. ${ROTATION_RULES.minCredits} créditos · até ${ROTATION_RULES.maxVideosPerCycle} vídeos e ${ROTATION_RULES.maxImagesPerCycle} imagens por conta`],
  ];

  return (
    <Modal open={open} onClose={submitting ? () => undefined : onCancel} title="Confirmar gerações reais no Flow">
      <div className="space-y-5">
        <div className="flex items-center gap-5">
          <div className="grid size-24 shrink-0 place-items-center rounded-full bg-primary/[0.14] text-center text-link ring-2 ring-primary/40" aria-label={`Até ${est.maxGenerations} gerações`}>
            <span>
              <span className="block text-xs font-semibold uppercase tracking-wide">Até</span>
              <span className="block text-3xl font-bold leading-8">{est.maxGenerations}</span>
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            gerações no Google Flow, contando a folga de {est.retryAllowance} para refazer o que falhar. O custo em créditos é descontado das contas da rotação.
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

        {eligibleAccounts === 0 && (
          <Alert tone="warning">Nenhuma conta Flow elegível na rotação. Nesta versão a geração é simulada, então o trabalho roda mesmo assim.</Alert>
        )}

        <div>
          <p className="mb-2 text-sm font-semibold">O que será enviado ao Google Flow</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Prompts gerados com as suas chaves Gemini, a partir da copy e da descrição do personagem.</li>
            <li>{avatar ? `As fotos de referência de ${avatar.name}.` : 'O quadro original do vídeo, mantendo a pessoa original.'}</li>
            <li>Uma imagem-base e um vídeo por variação, no formato {state.format}, modelo {labelOf(MODELS, state.model)} em {state.resolution}.</li>
          </ul>
        </div>

        <div>
          <button type="button" aria-expanded={details} onClick={() => setDetails((v) => !v)} className="flex items-center gap-1 text-sm font-medium text-link hover:underline">
            Ver configuração e cálculo detalhado <ChevronDown className={cn('size-4 transition-transform', details && 'rotate-180')} />
          </button>
          {details && (
            <div className="mt-3 space-y-2 rounded-xl bg-inset p-4 text-sm text-muted-foreground">
              <p>
                <span className="font-semibold text-foreground">Cálculo:</span> {est.videos} vídeos + {est.baseImages} imagens-base = {est.videos + est.baseImages} gerações, mais folga de {est.retryAllowance} para novas tentativas = até {est.maxGenerations}.
              </p>
              <p>
                <span className="font-semibold text-foreground">Configuração:</span> {state.video?.name} · {labelOf(LANGUAGES, state.language)} · {state.variations} {state.variations === 1 ? 'variação' : 'variações'}.
              </p>
            </div>
          )}
        </div>

        <p className="text-xs text-muted-foreground">Nesta fase a geração é simulada: nenhum crédito do Flow é usado e os arquivos são placeholders.</p>
        {error && <Alert>{error}</Alert>}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="ghost" onClick={onCancel} disabled={submitting}>
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
