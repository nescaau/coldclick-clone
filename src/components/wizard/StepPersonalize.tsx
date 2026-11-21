'use client';

import { Check, ChevronDown, Plus, Search, User } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  AXES,
  AXIS_MODES,
  CREATIVE_FORMATS,
  CTA_CUSTOM_LABEL,
  CTA_PRESETS,
  IMAGE_MODELS,
  SCRIPT_MODES,
  type AxisId,
  type AxisModeId,
  type CreativeFormatId,
  type ImageModelId,
  type ScriptModeId,
} from '@/lib/catalog';
import { ROUTES } from '@/lib/nav';
import type { AvatarDTO } from '@/lib/types';
import { Button, cn, LinkButton, Segmented } from '../ui';
import type { WizardState } from './state';

interface Props {
  state: WizardState;
  avatars: AvatarDTO[];
  onChange: (patch: Partial<WizardState>) => void;
  onNewAvatar: () => void;
}

const SOURCE_TABS = [
  { id: 'all', label: 'Todos' },
  { id: 'mine', label: 'Minha biblioteca' },
  { id: 'global', label: 'Global' },
] as const;

/** Select nativo com o visual dos comboboxes da plataforma. */
function Select({ id, label, value, onChange, children }: { id: string; label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-semibold">
        {label}
      </label>
      <span className="relative block">
        <select id={id} className="field appearance-none pr-9" value={value} onChange={(e) => onChange(e.target.value)}>
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      </span>
    </div>
  );
}

/** Cartão selecionável de avatar (multi-seleção). */
function AvatarCard({ selected, onToggle, image, tag, title, subtitle }: { selected: boolean; onToggle: () => void; image?: string; tag: string; title: string; subtitle: string }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onToggle}
      className={cn('relative grid min-w-0 content-start gap-2 rounded-2xl p-2 text-left transition-colors', selected ? 'bg-primary/[0.14] ring-2 ring-primary' : 'bg-accent/25 hover:bg-accent/40')}
    >
      <div className="relative aspect-[4/5] overflow-hidden rounded-xl bg-[rgb(16_24_40)]">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt={title} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="grid h-full place-items-center text-muted-foreground">
            <User className="size-10" />
          </div>
        )}
        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2.5 pb-2 pt-6 text-xs font-semibold text-white">{tag}</span>
        {selected && (
          <span className="absolute right-2 top-2 grid size-6 place-items-center rounded-full bg-primary text-primary-foreground">
            <Check className="size-4" />
          </span>
        )}
      </div>
      <div className="min-w-0 px-1 pb-1">
        <p className="truncate text-sm font-semibold">{title}</p>
        <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
      </div>
    </button>
  );
}

const axisNote = (label: string, mode: AxisModeId) =>
  mode === 'original' ? `A ${label.toLowerCase()} original será mantida.` : mode === 'preset' ? `A ${label.toLowerCase()} será trocada pelo preset escolhido.` : `A ${label.toLowerCase()} seguirá a sua descrição.`;

/** Etapa 3 · Personalização ("Avatar e formato"): avatares, modo do roteiro, formato criativo, eixos, modelo de imagem e CTA. */
export function StepPersonalize({ state, avatars, onChange, onNewAvatar }: Props) {
  const [tab, setTab] = useState<(typeof SOURCE_TABS)[number]['id']>('all');
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    if (tab === 'global') return []; // não há avatares globais nesta réplica
    const q = query.trim().toLowerCase();
    return avatars.filter((a) => !q || a.name.toLowerCase().includes(q));
  }, [avatars, tab, query]);

  const toggleAvatar = (id: string) =>
    onChange({ avatarIds: state.avatarIds.includes(id) ? state.avatarIds.filter((x) => x !== id) : [...state.avatarIds, id] });

  const setAxis = (axis: AxisId, mode: AxisModeId, value?: string) =>
    onChange({ axes: { ...state.axes, [axis]: { mode, value: value ?? (mode === state.axes[axis].mode ? state.axes[axis].value : '') } } });

  const anyAxis = AXES.some((a) => state.axes[a.id].mode !== 'original');

  return (
    <div className="space-y-7">
      <div>
        <p className="eyebrow">Personalização</p>
        <h3 className="mt-1 text-xl font-bold tracking-tight">Quem aparece neste vídeo?</h3>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          Escolha um avatar para substituir a pessoa do vídeo de referência. Cenário, câmera e ação continuam guiados pelo vídeo original.
        </p>
      </div>

      <section aria-label="Escolha um ou mais avatares" className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h4 className="text-base font-semibold">Escolha um ou mais avatares</h4>
            <p className="text-sm text-muted-foreground">
              {avatars.length} {avatars.length === 1 ? 'avatar disponível' : 'avatares disponíveis'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={onNewAvatar}>
              <Plus /> Novo avatar
            </Button>
            <LinkButton href={ROUTES.avatars} variant="ghost">
              Biblioteca
            </LinkButton>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-52 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input className="field pl-9" placeholder="Buscar avatar pelo nome" aria-label="Buscar avatar" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div role="group" aria-label="Filtrar avatares" className="flex gap-1 rounded-xl bg-muted/60 p-1">
            {SOURCE_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn('min-h-9 shrink-0 rounded-lg px-3 text-[13px] font-medium transition-colors', tab === t.id ? 'bg-card text-foreground' : 'text-muted-foreground hover:text-foreground')}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div role="group" aria-label="Selecionar avatares do lote" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          <AvatarCard selected={state.avatarIds.length === 0} onToggle={() => onChange({ avatarIds: [] })} tag="Quadro original" title="Manter pessoa original" subtitle="Sem troca de identidade" />
          {visible.map((a) => (
            <AvatarCard key={a.id} selected={state.avatarIds.includes(a.id)} onToggle={() => toggleAvatar(a.id)} image={a.photos[0]?.url} tag="Minha biblioteca" title={a.name} subtitle={a.voice || a.description} />
          ))}
        </div>
        {tab === 'global' && <p className="text-xs text-muted-foreground">Não há avatares globais disponíveis.</p>}
      </section>

      <section aria-label="Variações" className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Select id="script-mode" label="Modo do roteiro" value={state.scriptMode} onChange={(v) => onChange({ scriptMode: v as ScriptModeId })}>
            {SCRIPT_MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </Select>
          <Select id="creative-format" label="Formato criativo" value={state.creativeFormat} onChange={(v) => onChange({ creativeFormat: v as CreativeFormatId })}>
            {CREATIVE_FORMATS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <h4 className="text-base font-semibold">Variações</h4>
          <p className="mt-0.5 text-sm text-muted-foreground">Selecione o que pode mudar entre as versões. Os demais elementos continuam seguindo o vídeo original.</p>
        </div>

        <div className="space-y-4">
          {AXES.map((axis) => {
            const choice = state.axes[axis.id];
            return (
              <div key={axis.id} role="group" aria-label={axis.label} className="space-y-2">
                <p className="text-sm font-semibold">{axis.label}</p>
                <Segmented label={axis.label} value={choice.mode} options={AXIS_MODES} compact onChange={(mode) => setAxis(axis.id, mode)} />
                {choice.mode === 'preset' && (
                  <span className="relative block">
                    <select className="field appearance-none pr-9" aria-label={`Preset de ${axis.label.toLowerCase()}`} value={choice.value} onChange={(e) => setAxis(axis.id, 'preset', e.target.value)}>
                      <option value="">Escolha um preset</option>
                      {axis.presets.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  </span>
                )}
                {choice.mode === 'describe' && (
                  <textarea className="field min-h-20 resize-y" aria-label={`Descrição de ${axis.label.toLowerCase()}`} maxLength={300} placeholder={`Descreva ${axis.label === 'Roupa' ? 'a roupa' : axis.label === 'Cenário' ? 'o cenário' : 'o objeto'} desejado`} value={choice.value} onChange={(e) => setAxis(axis.id, 'describe', e.target.value)} />
                )}
                <p className="text-xs text-muted-foreground">{axisNote(axis.label, choice.mode)}</p>
              </div>
            );
          })}
          {!anyAxis && <p className="text-sm text-muted-foreground">Sem eixos visuais selecionados, cada avatar gera uma versão do mesmo vídeo.</p>}
        </div>

        <div className="space-y-3 rounded-2xl bg-inset p-4" role="group" aria-label="Modelo de imagem do Google Flow">
          <div>
            <h4 className="text-base font-semibold">Modelo de imagem do Google Flow</h4>
            <p className="mt-0.5 text-sm leading-6 text-muted-foreground">
              O modelo de vídeo e a resolução podem ser escolhidos no resumo do trabalho. Disponibilidade e custo variam conforme a conta conectada.
            </p>
          </div>
          <Select id="image-model" label="Modelo de imagem" value={state.imageModel} onChange={(v) => onChange({ imageModel: v as ImageModelId })}>
            {IMAGE_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-2">
          <Select id="cta" label="Chamada para ação (CTA)" value={state.ctaChoice} onChange={(v) => onChange({ ctaChoice: v as WizardState['ctaChoice'] })}>
            {CTA_PRESETS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
            <option value="custom">{CTA_CUSTOM_LABEL}</option>
          </Select>
          {state.ctaChoice === 'custom' && (
            <input className="field" aria-label="Texto da chamada para ação" maxLength={200} placeholder="Ex.: Clique no link da bio" value={state.ctaCustom} onChange={(e) => onChange({ ctaCustom: e.target.value })} />
          )}
        </div>
      </section>
    </div>
  );
}
