'use client';

import { ChevronDown, ImagePlus, Plus, Search, SlidersHorizontal, Trash2, User, Video, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { PageLayout } from '../PageLayout';
import { apiFetch, errorMessage } from '@/lib/client';
import { ROUTES } from '@/lib/nav';
import type { AvatarDTO } from '@/lib/types';
import { Alert, Button, Card, cn, EmptyState, Field, LinkButton, Modal, Pill } from '../ui';

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

  const remove = async (a: AvatarDTO) => {
    if (!confirm(`Remover o avatar "${a.name}" e suas fotos? Trabalhos já criados mantêm uma cópia dos dados.`)) return;
    try {
      await apiFetch(`/api/avatars/${a.id}`, { method: 'DELETE' });
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
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
                <AvatarCard key={a.id} avatar={a} onEdit={() => setEditing(a)} onRemove={() => remove(a)} />
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

function AvatarFormModal({ avatar, open, onClose, onSaved }: { avatar: AvatarDTO | null; open: boolean; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(avatar?.name ?? '');
  const [description, setDescription] = useState(avatar?.description ?? '');
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pré-visualização das fotos novas (URLs de objeto precisam ser liberadas).
  const previews = useMemo(() => newFiles.map((f) => URL.createObjectURL(f)), [newFiles]);
  useEffect(() => () => previews.forEach(URL.revokeObjectURL), [previews]);

  const keptPhotos = (avatar?.photos ?? []).filter((p) => !removed.includes(p.id));
  const totalPhotos = keptPhotos.length + newFiles.length;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const form = new FormData();
      form.set('name', name);
      form.set('description', description);
      newFiles.forEach((f) => form.append('photos', f));
      if (removed.length) form.set('removePhotoIds', JSON.stringify(removed));
      await apiFetch(avatar ? `/api/avatars/${avatar.id}` : '/api/avatars', { method: avatar ? 'PUT' : 'POST', body: form });
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={avatar ? 'Editar perfil e fotos' : 'Adicionar avatar'} size="lg">
      <div className="space-y-5">
        {error && <Alert>{error}</Alert>}
        <Field label="Nome">
          <input className="field" maxLength={80} placeholder="Ex.: Katie Brooks" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Descrição do personagem (em inglês)" hint="Inclua idade, aparência, roupa e cenário. Esse texto vai direto para o prompt de geração.">
          <textarea
            className="field min-h-32 resize-y"
            maxLength={2000}
            placeholder="40-year-old American woman, light skin, long straight brown hair, natural makeup, standing in a bright home hallway…"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>

        <div>
          <p className="mb-1.5 text-sm font-semibold">Fotos de referência ({totalPhotos})</p>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            {keptPhotos.map((p) => (
              <Thumb key={p.id} src={p.url} onRemove={() => setRemoved((r) => [...r, p.id])} />
            ))}
            {previews.map((src, i) => (
              <Thumb key={src} src={src} isNew onRemove={() => setNewFiles((files) => files.filter((_, idx) => idx !== i))} />
            ))}
            <label className="grid aspect-[3/4] cursor-pointer place-items-center rounded-xl border-2 border-dashed border-border text-muted-foreground transition hover:border-primary hover:text-link">
              <input
                type="file"
                multiple
                accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  setNewFiles((prev) => [...prev, ...Array.from(e.target.files ?? [])]);
                  e.target.value = '';
                }}
              />
              <span className="flex flex-col items-center gap-1 text-xs">
                <ImagePlus className="size-5" />
                Adicionar
              </span>
            </label>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">JPG, PNG ou WebP, até 10 MB cada. Dá para selecionar várias de uma vez.</p>
        </div>

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={save} loading={saving} disabled={!name.trim() || !description.trim()}>
            {avatar ? 'Salvar alterações' : 'Criar avatar'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Thumb({ src, onRemove, isNew }: { src: string; onRemove: () => void; isNew?: boolean }) {
  return (
    <div className="group relative aspect-[3/4] overflow-hidden rounded-xl border border-border bg-secondary">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className="h-full w-full object-cover" />
      {isNew && <span className="absolute bottom-1 left-1 rounded bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">NOVA</span>}
      <button type="button" onClick={onRemove} className="absolute right-1 top-1 grid size-6 place-items-center rounded-full bg-black/70 text-white opacity-0 transition group-hover:opacity-100" aria-label="Remover foto">
        <X className="size-3.5" />
      </button>
    </div>
  );
}
