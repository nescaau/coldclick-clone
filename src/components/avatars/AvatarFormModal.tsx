'use client';

import { ImagePlus, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { apiFetch, errorMessage } from '@/lib/client';
import { MAX_PHOTO_MB } from '@/lib/limits';
import type { AvatarDTO } from '@/lib/types';
import { Alert, Button, Field, Modal } from '../ui';

/** Criar/editar avatar: nome, descrição visual, descrição da voz e fotos de referência. */
export function AvatarFormModal({ avatar, open, onClose, onSaved }: { avatar: AvatarDTO | null; open: boolean; onClose: () => void; onSaved: (saved: AvatarDTO) => void }) {
  const [name, setName] = useState(avatar?.name ?? '');
  const [description, setDescription] = useState(avatar?.description ?? '');
  const [voice, setVoice] = useState(avatar?.voice ?? '');
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
      form.set('voice', voice);
      newFiles.forEach((f) => form.append('photos', f));
      if (removed.length) form.set('removePhotoIds', JSON.stringify(removed));
      const saved = await apiFetch<AvatarDTO>(avatar ? `/api/avatars/${avatar.id}` : '/api/avatars', { method: avatar ? 'PUT' : 'POST', body: form });
      onSaved(saved);
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

        <Field label="Descrição da voz (em inglês)" hint="Opcional. Ex.: tom, sotaque e ritmo da fala. Aparece ao escolher avatares no novo trabalho.">
          <textarea
            className="field min-h-20 resize-y"
            maxLength={600}
            placeholder="Clear, serious, caring American female voice, medium pitch, educational and direct…"
            value={voice}
            onChange={(e) => setVoice(e.target.value)}
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
          <p className="mt-2 text-xs text-muted-foreground">JPG, PNG ou WebP, até {MAX_PHOTO_MB} MB cada. Dá para selecionar várias de uma vez.</p>
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
