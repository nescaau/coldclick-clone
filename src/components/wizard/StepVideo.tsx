'use client';

import { FileVideo, FileVideo2, Link2, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { apiFetch, errorMessage, jsonInit, readVideoDuration, uploadWithProgress } from '@/lib/client';
import { formatBytes, formatDuration } from '@/lib/format';
import { MAX_VIDEO_MB } from '@/lib/limits';
import type { VideoDTO } from '@/lib/types';
import { Alert, cn, DateText, Pill, ProgressBar, Button } from '../ui';

const MAX_BYTES = MAX_VIDEO_MB * 1024 * 1024;
const ACCEPT = '.mp4,.mov,.webm,video/mp4,video/quicktime,video/webm';
type Source = 'upload' | 'library' | 'url';

interface Props {
  videos: VideoDTO[];
  selected: VideoDTO | null;
  onVideosChange: (videos: VideoDTO[]) => void;
  onSelect: (video: VideoDTO | null) => void;
  /** Bytes adicionados à conta após um envio (atualiza o card de armazenamento). */
  onUploaded: (bytes: number) => void;
}

export function StepVideo({ videos, selected, onVideosChange, onSelect, onUploaded }: Props) {
  const [source, setSource] = useState<Source>('upload');
  const [error, setError] = useState<string | null>(null);

  /** Registra um vídeo novo na lista e o seleciona. */
  const adopt = (video: VideoDTO) => {
    onVideosChange([video, ...videos.filter((v) => v.id !== video.id)]);
    onSelect(video);
    onUploaded(video.sizeBytes);
    setError(null);
  };

  const remove = async (video: VideoDTO) => {
    if (!confirm(`Excluir "${video.name}" dos vídeos enviados?`)) return;
    try {
      await apiFetch(`/api/videos/${video.id}`, { method: 'DELETE' });
      onVideosChange(videos.filter((v) => v.id !== video.id));
      if (selected?.id === video.id) onSelect(null);
      onUploaded(-video.sizeBytes);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const sources: Array<{ id: Source; label: string; icon: typeof Upload }> = [
    { id: 'upload', label: 'Enviar vídeo novo', icon: Upload },
    { id: 'library', label: 'Usar vídeo já enviado', icon: FileVideo },
    { id: 'url', label: 'Importar por URL', icon: Link2 },
  ];

  return (
    <div className="space-y-4">
      <div>
        <p id="source-label" className="mb-2 text-sm font-semibold">
          Vídeo de referência
        </p>
        <div role="group" aria-label="Origem do vídeo" className="grid gap-2 sm:grid-cols-3">
          {sources.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-pressed={source === id}
              onClick={() => setSource(id)}
              className={cn(
                'flex min-h-12 items-center gap-2 rounded-xl border px-4 text-left text-sm font-medium transition-colors [&_svg]:size-4 [&_svg]:shrink-0',
                source === id ? 'border-primary bg-primary/10 ring-2 ring-primary' : 'border-input bg-accent/35 hover:bg-accent/60',
              )}
            >
              <Icon />
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && <Alert>{error}</Alert>}

      {source === 'upload' && <UploadPane onDone={adopt} onError={setError} />}
      {source === 'url' && <UrlPane onDone={adopt} onError={setError} />}
      {source === 'library' && <LibraryPane videos={videos} selectedId={selected?.id ?? null} onSelect={onSelect} onDelete={remove} />}

      {source !== 'library' && <p className="text-xs text-muted-foreground">Clique ou arraste um arquivo. A seleção e o arraste passam pela mesma validação; o servidor também revalida o envio.</p>}
      {source === 'library' && <p className="text-xs text-muted-foreground">{selected ? `Vídeo selecionado: ${selected.name}` : 'Nenhum vídeo enviado selecionado.'}</p>}
      {source !== 'library' && !selected && <p className="text-xs text-muted-foreground">Nenhum vídeo selecionado.</p>}

      {selected && source !== 'library' && (
        <div className="rounded-2xl bg-inset p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-link">Vídeo selecionado</p>
              <p className="truncate text-sm font-semibold">{selected.name}</p>
              <p className="text-xs text-muted-foreground">
                {formatBytes(selected.sizeBytes)} · {formatDuration(selected.durationSec)}
              </p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => onSelect(null)}>
              Trocar
            </Button>
          </div>
          <video src={selected.url} controls preload="metadata" className="max-h-64 w-full rounded-xl bg-black" />
        </div>
      )}
    </div>
  );
}

/* ---------------- Upload ---------------- */

function UploadPane({ onDone, onError }: { onDone: (v: VideoDTO) => void; onError: (m: string | null) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<(() => void) | null>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<{ name: string; percent: number } | null>(null);

  const start = async (file: File | undefined) => {
    if (!file) return;
    const ext = file.name.toLowerCase().match(/\.[^.]+$/)?.[0];
    if (!ext || !['.mp4', '.mov', '.webm'].includes(ext)) return onError('Formato não suportado. Envie MP4, MOV ou WebM.');
    if (file.size > MAX_BYTES) return onError(`O arquivo tem ${formatBytes(file.size)}. O limite é ${MAX_VIDEO_MB} MB.`);

    onError(null);
    setProgress({ name: file.name, percent: 0 });
    try {
      const duration = await readVideoDuration(file);
      const query = new URLSearchParams({ name: file.name });
      if (duration) query.set('duration', String(duration));
      const { promise, abort } = uploadWithProgress<VideoDTO>(`/api/videos?${query}`, file, (percent) => setProgress({ name: file.name, percent }));
      abortRef.current = abort;
      onDone(await promise);
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      abortRef.current = null;
      setProgress(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void start(e.dataTransfer.files[0]);
      }}
      onClick={() => !progress && inputRef.current?.click()}
      className={cn(
        'flex h-44 cursor-pointer flex-col items-center justify-center rounded-3xl border border-dashed px-6 text-center transition-colors',
        dragging ? 'border-primary bg-primary/10' : 'border-border bg-accent/30 hover:bg-accent/45',
        progress && 'cursor-default',
      )}
    >
      <input ref={inputRef} type="file" name="source_video" accept={ACCEPT} className="sr-only" onChange={(e) => void start(e.target.files?.[0])} />
      {progress ? (
        <div className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
          <p className="mb-2 truncate text-sm font-semibold">{progress.name}</p>
          <ProgressBar percent={progress.percent} label="Progresso do envio" />
          <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>Enviando… {progress.percent}%</span>
            <button type="button" className="text-destructive hover:underline" onClick={() => abortRef.current?.()}>
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <>
          <span className="mb-3 grid size-10 place-items-center rounded-xl bg-primary/[0.14] text-link">
            <FileVideo2 className="size-5" />
          </span>
          <p className="text-sm font-semibold">Arraste o vídeo até aqui ou clique para escolher</p>
          <p className="mt-1 text-xs text-link/80">MP4, MOV ou WebM · até {MAX_VIDEO_MB} MB</p>
        </>
      )}
    </div>
  );
}

/* ---------------- URL ---------------- */

function UrlPane({ onDone, onError }: { onDone: (v: VideoDTO) => void; onError: (m: string | null) => void }) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    onError(null);
    setLoading(true);
    try {
      onDone(await apiFetch<VideoDTO>('/api/videos/import', jsonInit('POST', { url })));
      setUrl('');
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-3xl border border-dashed border-border bg-accent/30 p-6">
      <label className="mb-1.5 block text-sm font-semibold" htmlFor="video-url">
        Link direto para o vídeo
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id="video-url"
          className="field"
          placeholder="https://exemplo.com/meu-video.mp4"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && url.trim() && !loading && void submit()}
        />
        <Button variant="primary" onClick={submit} loading={loading} disabled={!url.trim()}>
          Importar
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        O link precisa apontar direto para o arquivo (MP4, MOV ou WebM, até {MAX_VIDEO_MB} MB). Páginas de YouTube/Instagram não funcionam. O download pode levar alguns minutos.
      </p>
    </div>
  );
}

/* ---------------- Biblioteca de vídeos enviados ---------------- */

function LibraryPane({ videos, selectedId, onSelect, onDelete }: { videos: VideoDTO[]; selectedId: string | null; onSelect: (v: VideoDTO) => void; onDelete: (v: VideoDTO) => void }) {
  if (videos.length === 0) {
    return (
      <div className="space-y-3 rounded-2xl bg-inset p-4 text-sm text-muted-foreground">
        <p>Selecione um vídeo válido que você já enviou. Ele será lido pelo player autenticado; o navegador não baixa uma cópia completa para reenviar.</p>
        <p>Nenhum vídeo enviado está disponível. Envie um vídeo novo para continuar.</p>
      </div>
    );
  }
  return (
    <div className="space-y-3 rounded-2xl bg-inset p-4">
      <p className="text-sm text-muted-foreground">Selecione um vídeo válido que você já enviou. Ele será lido pelo player autenticado; o navegador não baixa uma cópia completa para reenviar.</p>
      <ul className="grid gap-3 sm:grid-cols-2">
        {videos.map((v) => (
          <li key={v.id} className={cn('group flex items-center gap-3 rounded-xl border bg-card p-3 transition-colors', v.id === selectedId ? 'border-primary ring-2 ring-primary' : 'border-border hover:border-muted-foreground/40')}>
            <button type="button" onClick={() => onSelect(v)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
              <video src={`${v.url}#t=0.5`} preload="metadata" muted className="h-16 w-12 shrink-0 rounded-md bg-black object-cover" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{v.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(v.sizeBytes)} · {formatDuration(v.durationSec)} · <DateText iso={v.createdAt} withTime={false} />
                </p>
                <div className="mt-1 flex gap-1">
                  {v.transcript && <Pill tone="success">Transcrito</Pill>}
                  {v.source === 'url' && <Pill>URL</Pill>}
                </div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => onDelete(v)}
              className="rounded-md p-1.5 text-muted-foreground opacity-0 transition hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
              aria-label={`Excluir ${v.name}`}
            >
              <Trash2 className="size-4" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
