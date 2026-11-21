'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import { labelOf, MODELS, OMNI_MODEL, RESOLUTIONS, isResolutionAllowed, type ModelId, type ResolutionId } from '@/lib/catalog';
import { Button, cn } from '../ui';
import { copyWords, outputsOf, type WizardState } from './state';

function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold">{label}</span>
      <span className="relative block">
        <select className="field appearance-none bg-secondary pr-9" value={value} onChange={(e) => onChange(e.target.value)}>
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      </span>
    </label>
  );
}

/** Painel fixo "Resumo do trabalho": nome, resumo da seleção, modelo/resolução e acesso à revisão. */
export function SummaryPanel({ state, avatarNames, defaultTitle, showAvatarBlock, canReview, onChange, onReview }: {
  state: WizardState;
  avatarNames: string[];
  defaultTitle: string;
  /** Na etapa Personalização aparece o bloco "Avatares selecionados". */
  showAvatarBlock: boolean;
  canReview: boolean;
  onChange: (patch: Partial<WizardState>) => void;
  onReview: () => void;
}) {
  const outputs = outputsOf(state);
  const words = copyWords(state);
  const rows: Array<[string, string]> = [
    ['Vídeo de referência', state.video?.name ?? 'Ainda não selecionado'],
    ['Copy', words > 0 ? `${words} ${words === 1 ? 'palavra' : 'palavras'}` : 'Pendente'],
    ['Avatares', avatarNames.join(', ')],
    ['Saídas', `${outputs} ${outputs === 1 ? 'variação' : 'variações'}`],
  ];

  const changeModel = (model: ModelId) => {
    // Trocar para um modelo sem 360p volta a resolução para 720p.
    const resolution: ResolutionId = isResolutionAllowed(model, state.resolution) ? state.resolution : '720p';
    onChange({ model, resolution });
  };

  return (
    <section aria-label="Resumo do trabalho" className="space-y-4 rounded-2xl bg-inset p-[18px]">
      <div>
        <p className="eyebrow">Resumo do trabalho</p>
        <h3 className="mt-1 truncate text-base font-bold">{state.title.trim() || defaultTitle}</h3>
      </div>

      <div>
        <label htmlFor="job-title" className="mb-2 block text-sm font-semibold">
          Nome do trabalho
        </label>
        <input id="job-title" className="field min-h-9 bg-secondary" maxLength={120} placeholder={defaultTitle} value={state.title} onChange={(e) => onChange({ title: e.target.value })} />
        <p className="mt-2 text-xs leading-5 text-muted-foreground">Se deixar vazio, usaremos “{defaultTitle}”.</p>
      </div>

      {showAvatarBlock && (
        <div className="space-y-1">
          <p className="text-sm font-semibold">
            Avatares selecionados · <span className="tabular-nums">{outputs}</span>
          </p>
          <p className="text-sm text-muted-foreground">{avatarNames.join(', ')}</p>
          <p className="text-xs leading-5 text-muted-foreground">Cada avatar gera o mesmo vídeo com uma identidade diferente.</p>
        </div>
      )}

      <div className="space-y-3.5">
        {rows.map(([label, value]) => (
          <ul key={label}>
            <li className="text-xs text-muted-foreground">{label}</li>
            <li className="truncate text-sm font-semibold">{value}</li>
          </ul>
        ))}
      </div>

      <div className="space-y-3 rounded-xl bg-background/60 p-3">
        <Select label="Modelo de vídeo" value={state.model} onChange={(v) => changeModel(v as ModelId)}>
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </Select>
        <Select label="Resolução do vídeo" value={state.resolution} onChange={(v) => onChange({ resolution: v as ResolutionId })}>
          {RESOLUTIONS.map((r) => (
            <option key={r.id} value={r.id} disabled={!isResolutionAllowed(state.model, r.id)}>
              {r.label}
            </option>
          ))}
        </Select>
        <p className="text-xs leading-5 text-muted-foreground">360p só está disponível com {labelOf(MODELS, OMNI_MODEL)}.</p>
        <p className="text-xs leading-5 text-muted-foreground">As chamadas e o custo estimado serão calculados antes de iniciar. Nada é enviado ao Flow até sua confirmação.</p>
      </div>

      <Button variant="ghost" className={cn('w-full justify-between px-3 text-link hover:text-link', !canReview && 'opacity-60')} disabled={!canReview} onClick={onReview}>
        Revisar configuração <ChevronRight />
      </Button>
    </section>
  );
}
