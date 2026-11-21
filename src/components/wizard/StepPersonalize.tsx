'use client';

import { Check, Minus, Plus, Search, User } from 'lucide-react';
import { useMemo, useState } from 'react';
import { FORMATS, MAX_VARIATIONS, MIN_VARIATIONS } from '@/lib/catalog';
import { ROUTES } from '@/lib/nav';
import type { AvatarDTO } from '@/lib/types';
import { cn, LinkButton } from '../ui';
import type { WizardState } from './state';

interface Props {
  state: WizardState;
  avatars: AvatarDTO[];
  onChange: (patch: Partial<WizardState>) => void;
}

const SOURCE_TABS = [
  { id: 'all', label: 'Todos' },
  { id: 'mine', label: 'Minha biblioteca' },
  { id: 'global', label: 'Global' },
] as const;

const Section = ({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) => (
  <section>
    <h3 className="text-sm font-semibold">{title}</h3>
    {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    <div className="mt-3">{children}</div>
  </section>
);

/** Cartão selecionável de avatar (rounded-2xl p-2; selecionado: primary/14 + anel de 2px). */
function AvatarCard({ selected, onSelect, image, eyebrow, title, description }: { selected: boolean; onSelect: () => void; image?: string; eyebrow: string; title: string; description: string }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn('relative grid min-w-0 gap-2 rounded-2xl p-2 text-left transition-colors', selected ? 'bg-primary/[0.14] ring-2 ring-primary' : 'bg-accent/25 hover:bg-accent/40')}
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
        {selected && (
          <span className="absolute right-2 top-2 grid size-6 place-items-center rounded-full bg-primary text-primary-foreground">
            <Check className="size-4" />
          </span>
        )}
      </div>
      <div className="px-1 pb-1">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{eyebrow}</p>
        <p className="truncate text-sm font-semibold">{title}</p>
        <p className="line-clamp-2 text-xs text-muted-foreground">{description}</p>
      </div>
    </button>
  );
}

export function StepPersonalize({ state, avatars, onChange }: Props) {
  const [tab, setTab] = useState<(typeof SOURCE_TABS)[number]['id']>('all');
  const [query, setQuery] = useState('');
  const clamp = (n: number) => Math.min(MAX_VARIATIONS, Math.max(MIN_VARIATIONS, Math.round(n) || MIN_VARIATIONS));

  const visible = useMemo(() => {
    if (tab === 'global') return []; // não há avatares globais nesta réplica
    const q = query.trim().toLowerCase();
    return avatars.filter((a) => !q || a.name.toLowerCase().includes(q));
  }, [avatars, tab, query]);

  return (
    <div className="space-y-7">
      <Section title="Avatar" hint="Quem aparece nos vídeos. Mantenha a pessoa original ou escolha um avatar da biblioteca.">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Origem dos avatares" className="flex gap-1">
            {SOURCE_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn('min-h-11 shrink-0 rounded-lg px-3 text-[13px] font-medium transition-colors', tab === t.id ? 'bg-card text-foreground' : 'text-muted-foreground hover:text-foreground')}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input className="field pl-9" placeholder="Buscar avatar pelo nome" aria-label="Buscar avatar pelo nome" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <LinkButton href={ROUTES.avatars} variant="secondary">
            <Plus /> Novo avatar
          </LinkButton>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          <AvatarCard selected={state.avatarId === null} onSelect={() => onChange({ avatarId: null })} eyebrow="Quadro original" title="Manter pessoa original" description="Sem trocar a pessoa do vídeo por um avatar." />
          {visible.map((a) => (
            <AvatarCard key={a.id} selected={state.avatarId === a.id} onSelect={() => onChange({ avatarId: a.id })} image={a.photos[0]?.url} eyebrow="Minha biblioteca" title={a.name} description={a.description} />
          ))}
        </div>
        {tab === 'global' && <p className="mt-3 text-xs text-muted-foreground">Não há avatares globais disponíveis.</p>}
      </Section>

      <Section title="Formato">
        <div role="radiogroup" aria-label="Formato do vídeo" className="grid grid-cols-3 gap-3">
          {FORMATS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={state.format === f.id}
              onClick={() => onChange({ format: f.id })}
              className={cn('flex flex-col items-center gap-2 rounded-2xl border px-3 py-4 transition-colors', state.format === f.id ? 'border-primary bg-primary/10 ring-2 ring-primary' : 'border-input bg-accent/35 hover:bg-accent/60')}
            >
              <span
                className={cn('block rounded border-2', state.format === f.id ? 'border-primary' : 'border-muted-foreground/60')}
                style={{ width: Math.max(18, Math.round(36 * Math.min(1, f.ratio))), height: Math.max(18, Math.round(36 / Math.max(1, f.ratio))) }}
              />
              <span className="text-sm font-semibold">{f.label}</span>
              <span className="text-center text-xs text-muted-foreground">{f.hint}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Saídas" hint={`De ${MIN_VARIATIONS} a ${MAX_VARIATIONS} variações. Cada variação gera 1 imagem-base e 1 vídeo.`}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center rounded-md border border-input bg-secondary/45">
            <button type="button" className="p-3 text-muted-foreground hover:text-foreground disabled:opacity-40" onClick={() => onChange({ variations: clamp(state.variations - 1) })} disabled={state.variations <= MIN_VARIATIONS} aria-label="Diminuir">
              <Minus className="size-4" />
            </button>
            <input
              type="number"
              min={MIN_VARIATIONS}
              max={MAX_VARIATIONS}
              value={state.variations}
              onChange={(e) => onChange({ variations: clamp(Number(e.target.value)) })}
              className="w-16 bg-transparent text-center text-sm font-semibold outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
              aria-label="Número de variações"
            />
            <button type="button" className="p-3 text-muted-foreground hover:text-foreground disabled:opacity-40" onClick={() => onChange({ variations: clamp(state.variations + 1) })} disabled={state.variations >= MAX_VARIATIONS} aria-label="Aumentar">
              <Plus className="size-4" />
            </button>
          </div>
          <div className="flex gap-1.5">
            {[1, 5, 10, 20].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => onChange({ variations: n })}
                className={cn('min-h-9 rounded-xl px-3 text-sm font-medium transition-colors', state.variations === n ? 'bg-primary/[0.14] text-link' : 'bg-accent/35 text-muted-foreground hover:text-foreground')}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      </Section>
    </div>
  );
}
