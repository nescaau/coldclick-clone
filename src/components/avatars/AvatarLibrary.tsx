'use client';

import { ChevronDown, Plus, Search, SlidersHorizontal, Trash2, User, Video } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { PageLayout } from '../PageLayout';
import { apiFetch, errorMessage } from '@/lib/client';
import { ROUTES } from '@/lib/nav';
import type { AvatarDTO } from '@/lib/types';
import { Alert, Button, Card, cn, ConfirmDialog, EmptyState, LinkButton, Pill } from '../ui';
import { AvatarFormModal } from './AvatarFormModal';

const PAGE_SIZE = 6;
/** Todos os avatares desta réplica são pessoais e disponíveis; "Globais" e "Inativos" existem só na plataforma original. */
const TABS = [
  { id: 'all', label: 'Todos' },
  { id: 'personal', label: 'Pessoais' },
  { id: 'global', label: 'Globais' },
  { id: 'inactive', label: 'Inativos' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export function AvatarLibrary({ avatars }: { avatars: AvatarDTO[] }) {
  const router = useRouter();
  /** `null` = fechado; `'new'` = criando; AvatarDTO = editando. */
  const [editing, setEditing] = useState<AvatarDTO | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<AvatarDTO | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [tab, setTab] = useState<TabId>('all');
  const [query, setQuery] = useState('');
  const [applied, setApplied] = useState('');
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    if (tab === 'global' || tab === 'inactive') return [];
    const q = applied.trim().toLowerCase();
    return avatars.filter((a) => !q || a.name.toLowerCase().includes(q));
  }, [avatars, tab, applied]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const visible = filtered.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

  const confirmRemove = async () => {
    if (!removing) return;
    setRemoveBusy(true);
    try {
      await apiFetch(`/api/avatars/${removing.id}`, { method: 'DELETE' });
      setRemoving(null);
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
      setRemoving(null);
    } finally {
      setRemoveBusy(false);
    }
  };

  return (
    <PageLayout
      action={
        <LinkButton href={ROUTES.newJob} variant="primary">
          <Video /> Novo trabalho
        </LinkButton>
      }
    >
      <Card className="flex items-center justify-between gap-6 px-7 py-7">
        <div>
          <h1 className="text-3xl font-bold leading-9 tracking-[-0.005em]">Biblioteca de avatares</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Organize referências de personagem, fotos, voz, roupas e etiquetas. Itens pessoais são privados; itens globais ficam disponíveis para toda a equipe.
          </p>
        </div>
        <span className="hidden size-14 shrink-0 place-items-center rounded-2xl bg-primary/[0.14] text-link sm:grid">
          <User className="size-6" />
        </span>
      </Card>

      <p role="note" className="mt-6 rounded-xl bg-inset px-4 py-3 text-sm text-muted-foreground">
        As fotos são privadas e cada arquivo pode ter até 10 MB. Nesta etapa, elas servem como referência do avatar; não são enviadas a um gerador de mídia.
      </p>

      {error && (
        <div className="mt-4">
          <Alert>{error}</Alert>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_388px]">
        <section aria-label="Seus avatares" className="min-w-0">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="eyebrow">Biblioteca</p>
              <h2 className="text-[22px] font-bold leading-7 tracking-tight">Seus avatares</h2>
              <p className="mt-1 text-sm text-muted-foreground">Selecione uma foto para ver os detalhes, editar ou organizar as referências.</p>
            </div>
            <Pill tone="neutral" className="shrink-0">
              {visible.length} nesta página
            </Pill>
          </div>

          <form
            role="search"
            className="mt-4 flex gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              setApplied(query);
              setPage(0);
            }}
          >
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                aria-label="Buscar avatar"
                placeholder="Buscar por nome"
                className="field pl-9"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setApplied(e.target.value);
                  setPage(0);
                }}
              />
            </div>
            <Button type="submit" variant="secondary">
              <Search /> Buscar
            </Button>
          </form>

          <div role="group" aria-label="Filtrar biblioteca de avatares" className="mt-4 flex gap-1 rounded-3xl bg-muted/60 p-1.5">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setTab(t.id);
                  setPage(0);
                }}
                className={cn(
                  'min-h-11 shrink-0 rounded-lg px-3 text-sm font-medium transition-colors',
                  tab === t.id ? 'bg-card text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {visible.length === 0 ? (
            <div className="mt-4">
              <EmptyState icon={<User className="size-9" />} title={avatars.length === 0 ? 'Nenhum avatar cadastrado' : 'Nenhum avatar encontrado'}>
                {avatars.length === 0
                  ? 'Crie um avatar com fotos de referência para usar nos seus trabalhos.'
                  : tab === 'global' || tab === 'inactive'
                    ? 'Não há avatares nesta categoria.'
                    : 'Tente outro nome.'}
              </EmptyState>
            </div>
          ) : (
            <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {visible.map((a) => (
                <AvatarCard key={a.id} avatar={a} onEdit={() => setEditing(a)} onRemove={() => setRemoving(a)} />
              ))}
            </div>
          )}

          {pages > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <Button variant="secondary" disabled={current === 0} onClick={() => setPage(current - 1)}>
                Anterior
              </Button>
              <Button variant="secondary" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
                Próxima página
              </Button>
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <Card className="p-6">
            <h2 className="text-base font-semibold">Adicionar avatar</h2>
            <p className="mt-1 text-sm text-muted-foreground">Crie uma referência e envie as fotos dela.</p>
            <Button variant="primary" className="mt-4 w-[275px] max-w-full" onClick={() => setEditing('new')}>
              <Plus /> Adicionar
            </Button>
          </Card>
          <Card className="p-6">
            <h2 className="text-base font-semibold">Etiquetas</h2>
            <p className="mt-1 text-sm text-muted-foreground">Organize e encontre fotos por tema.</p>
            <Button variant="ghost" className="mt-3 w-full" disabled title="Etiquetas existem apenas na plataforma original">
              <SlidersHorizontal /> Gerenciar
            </Button>
          </Card>
        </aside>
      </div>

      <AvatarFormModal
        // `key` remonta o formulário limpo a cada abertura/avatar diferente
        key={editing === null ? 'closed' : editing === 'new' ? 'new' : editing.id}
        avatar={editing === 'new' ? null : editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          router.refresh();
        }}
      />

      <ConfirmDialog
        open={removing !== null}
        title={`Remover “${removing?.name ?? ''}”?`}
        cancelLabel="Manter avatar"
        confirmLabel="Remover avatar"
        tone="danger"
        loading={removeBusy}
        onCancel={() => setRemoving(null)}
        onConfirm={confirmRemove}
      >
        <p>O avatar, as fotos e as associações de etiquetas serão removidos da biblioteca.</p>
      </ConfirmDialog>
    </PageLayout>
  );
}

function AvatarCard({ avatar, onEdit, onRemove }: { avatar: AvatarDTO; onEdit: () => void; onRemove: () => void }) {
  const photo = avatar.photos[0];
  return (
    <article className="flex flex-col overflow-hidden rounded-2xl bg-card pt-6">
      <div className="relative aspect-[4/5] bg-[rgb(16_24_40)]">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo.url} alt={avatar.name} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="grid h-full place-items-center text-muted-foreground">
            <User className="size-12" />
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-black/60 to-transparent p-3 pt-10">
          <span className="rounded-full bg-black/70 px-2.5 py-0.5 text-xs font-semibold text-white">Pessoal</span>
          <span className="rounded-full bg-black/55 px-2.5 py-0.5 text-xs font-semibold text-success">Disponível</span>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-5">
        <h3 className="truncate text-base font-semibold">{avatar.name}</h3>
        <button type="button" aria-label={`Remover ${avatar.name}`} onClick={onRemove} className="-ml-1 flex size-8 items-center justify-center rounded-md text-destructive hover:bg-destructive/10">
          <Trash2 className="size-4" />
        </button>
        <p className="line-clamp-2 min-h-10 text-sm leading-5 text-muted-foreground">{avatar.description}</p>
        <Button variant="secondary" className="w-full justify-start gap-2 [&>svg:last-child]:ml-auto" onClick={onEdit}>
          <SlidersHorizontal /> Editar perfil e fotos <ChevronDown />
        </Button>
      </div>
    </article>
  );
}
