'use client';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { MAX_VIRAL_MB } from '@/lib/limits';
import { apiGet } from '@/lib/client';
import type { EventDTO, ViralDTO } from '@/lib/types';
import { fmtMb, T } from './ui';

interface Props {
  viral: ViralDTO | null;
  /** A conversa já tem mensagens: trocar o viral abre uma conversa nova (regra do original). */
  temMensagens: boolean;
  enviando: boolean;
  desabilitado: boolean;
  onArquivo: (file: File) => void;
  onAbrirBiblioteca: () => void;
  onTirar: () => void;
}

/** Bloco "🎬 VIRAL DESTA CONVERSA": dropzone, viral anexado e "↺ Usar um viral que você já enviou". */
export function ViralCard({ viral, temMensagens, enviando, desabilitado, onArquivo, onAbrirBiblioteca, onTirar }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [arrastando, setArrastando] = useState(false);
  const [avisoTroca, setAvisoTroca] = useState(false);
  const [verLog, setVerLog] = useState(true);
  const [log, setLog] = useState<EventDTO[]>([]);

  useEffect(() => {
    if (!viral) return setLog([]);
    let vivo = true;
    apiGet<EventDTO[]>(`/virals/${viral.id}`)
      .then((l) => vivo && setLog(l))
      .catch(() => vivo && setLog([]));
    return () => {
      vivo = false;
    };
  }, [viral]);

  const escolher = () => inputRef.current?.click();
  const aoSoltar = (e: DragEvent) => {
    e.preventDefault();
    setArrastando(false);
    const f = e.dataTransfer.files?.[0];
    if (f && !desabilitado) onArquivo(f);
  };

  return (
    <section aria-label="Viral desta conversa" className={`space-y-3 p-4 ${T.cartaoInterno}`}>
      <h3 className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-white">
        <span aria-hidden="true">🎬</span> VIRAL DESTA CONVERSA
      </h3>

      <input
        ref={inputRef}
        type="file"
        accept="video/mp4,.mp4"
        className="sr-only"
        aria-label="Escolher o vídeo viral"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          setAvisoTroca(false);
          if (f) onArquivo(f);
        }}
      />

      {viral ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-black/30 p-3">
            <div className="flex h-14 w-10 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-lg" aria-hidden="true">
              🎬
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-black text-white" title={viral.name}>
                {viral.name.replace(/\.mp4$/i, '')}
              </p>
              <p className={`text-xs ${T.textoFraco}`}>
                {fmtMb(viral.sizeBytes)} · <span className="font-mono uppercase">{viral.state}</span>
              </p>
              <button type="button" onClick={() => setVerLog((v) => !v)} aria-expanded={verLog} className={`text-xs ${T.link}`}>
                {verLog ? 'esconder análise' : 'ver análise'}
              </button>
            </div>
            <button
              type="button"
              disabled={desabilitado || enviando}
              onClick={() => (temMensagens ? setAvisoTroca(true) : escolher())}
              className={`shrink-0 rounded-xl px-3 py-1.5 text-xs ${T.botaoVidro}`}
            >
              Trocar viral
            </button>
            <button
              type="button"
              disabled={desabilitado || enviando}
              onClick={onTirar}
              title="A conversa continua sem viral: o Diretor planeja a partir da sua ideia. A leitura fica guardada em Analisados."
              className={`shrink-0 rounded-xl px-3 py-1.5 text-xs ${T.botaoVidro}`}
            >
              Tirar o viral
            </button>
          </div>

          {avisoTroca && (
            <div role="alert" className="space-y-2 rounded-xl border border-amber-400/70 bg-amber-500/10 p-3 text-sm">
              <p className="font-bold text-white">Trocar o viral abre uma conversa nova com ele.</p>
              <div className="flex gap-2">
                <button type="button" onClick={escolher} className={`rounded-xl px-3 py-1.5 text-xs ${T.botaoPrimario}`}>
                  Escolher outro viral
                </button>
                <button type="button" onClick={() => setAvisoTroca(false)} className={`rounded-xl px-3 py-1.5 text-xs ${T.botaoVidro}`}>
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {verLog && (
            <ul aria-label="Log local do viral" className="space-y-1 rounded-xl bg-black/30 p-3 font-mono text-[11px] leading-snug text-zinc-400">
              {log.length === 0 && <li>Sem registros.</li>}
              {log.map((l) => (
                <li key={l.id} className={l.level === 'aviso' ? 'text-amber-300' : l.level === 'erro' ? 'text-red-300' : ''}>
                  · {l.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div
          role="button"
          tabIndex={0}
          aria-label="Arraste o vídeo viral aqui ou clique pra escolher"
          onClick={() => !desabilitado && !enviando && escolher()}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !desabilitado && escolher()}
          onDragOver={(e) => {
            e.preventDefault();
            setArrastando(true);
          }}
          onDragLeave={() => setArrastando(false)}
          onDrop={aoSoltar}
          className={`flex min-h-[128px] cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl px-4 py-6 text-center ${arrastando ? T.dropArrastando : T.dropOcioso}`}
        >
          <span className="text-3xl" aria-hidden="true">
            ⬇️
          </span>
          <span className="text-lg font-black text-white">{enviando ? 'Guardando o viral…' : arrastando ? 'Solte o vídeo aqui' : 'Arraste o vídeo viral aqui ou clique pra escolher'}</span>
          <span className="text-xs text-zinc-300">
            MP4 até <span>{MAX_VIRAL_MB}</span> MB · o Diretor assiste e copia a estrutura
          </span>
        </div>
      )}

      <button type="button" onClick={onAbrirBiblioteca} disabled={desabilitado} className={`rounded-xl px-4 py-2 text-sm ${T.botaoVidro}`}>
        ↺ Usar um viral que você já enviou
      </button>
    </section>
  );
}
