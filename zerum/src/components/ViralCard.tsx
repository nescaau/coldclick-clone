'use client';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { MAX_VIRAL_MB } from '@/lib/limits';
import { apiGet } from '@/lib/client';
import { BASE_PATH } from '@/lib/config.shared';
import { analysisBullets, clip, fmtDuration } from '@/lib/domain/analysis';
import type { EventDTO, ViralDTO } from '@/lib/types';
import { T } from './ui';
import { ViralEditor } from './ViralEditor';

interface Props {
  viral: ViralDTO | null;
  /** A conversa já tem mensagens: trocar o viral abre uma conversa nova (regra do original). */
  temMensagens: boolean;
  enviando: boolean;
  desabilitado: boolean;
  onArquivo: (file: File) => void;
  onAbrirBiblioteca: () => void;
  onTirar: () => void;
  /** O viral foi corrigido / voltou à original. */
  onViralMudou: (v: ViralDTO) => void;
}

/** Miniatura = o primeiro quadro do próprio arquivo local (sem gerar imagem nem sair da máquina). */
export function ViralThumb({ id, className = 'h-14 w-10' }: { id: string; className?: string }) {
  return (
    <video
      src={`${BASE_PATH}/api/virals/${id}/video#t=0.1`}
      preload="metadata"
      muted
      playsInline
      tabIndex={-1}
      aria-hidden="true"
      className={`${className} shrink-0 rounded-lg border border-white/10 bg-white/5 object-cover`}
    />
  );
}

/** Bloco "🎬 VIRAL DESTA CONVERSA": dropzone, viral anexado com a análise e "↺ Usar um viral que você já enviou". */
export function ViralCard({ viral, temMensagens, enviando, desabilitado, onArquivo, onAbrirBiblioteca, onTirar, onViralMudou }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [arrastando, setArrastando] = useState(false);
  const [avisoTroca, setAvisoTroca] = useState(false);
  const [verAnalise, setVerAnalise] = useState(true);
  const [corrigindo, setCorrigindo] = useState(false);
  const [log, setLog] = useState<EventDTO[]>([]);

  const viralId = viral?.id;
  const ver = viral?.corrected;
  useEffect(() => {
    if (!viralId) return setLog([]);
    let vivo = true;
    apiGet<{ events: EventDTO[] }>(`/virals/${viralId}`)
      .then((r) => vivo && setLog(r.events))
      .catch(() => vivo && setLog([]));
    return () => {
      vivo = false;
    };
  }, [viralId, ver]);

  const escolher = () => inputRef.current?.click();
  const aoSoltar = (e: DragEvent) => {
    e.preventDefault();
    setArrastando(false);
    const f = e.dataTransfer.files?.[0];
    if (f && !desabilitado) onArquivo(f);
  };

  const a = viral?.analysis ?? null;
  const bullets = viral && a ? analysisBullets(a, viral) : [];

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
            <ViralThumb id={viral.id} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-black text-white" title={viral.name}>
                <span>{viral.name.replace(/\.mp4$/i, '')}</span>
                <span className="font-normal text-zinc-300"> · {viral.durationS !== null ? `${fmtDuration(viral.durationS)} · ` : ''}lido ✓</span>
              </p>
              <button type="button" onClick={() => setVerAnalise((v) => !v)} aria-expanded={verAnalise} className={`text-xs ${T.link}`}>
                {verAnalise ? 'esconder análise' : 'ver análise'}
              </button>
            </div>
            <button type="button" disabled={desabilitado || enviando} onClick={() => (temMensagens ? setAvisoTroca(true) : escolher())} className={`shrink-0 rounded-xl px-3 py-1.5 text-xs ${T.botaoVidro}`}>
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

          {verAnalise && a && (
            <div className="space-y-2 text-xs leading-snug text-zinc-200">
              {bullets.length > 0 && (
                <ul className="list-disc space-y-0.5 pl-5 text-zinc-300">
                  {bullets.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              )}
              {viral.gancho && (
                <p>
                  <b className="text-white">Gancho:</b> “{clip(viral.gancho, 200)}”
                </p>
              )}
              {a.estrutura && (
                <p>
                  <b className="text-white">Estrutura:</b> {clip(a.estrutura, 200)}
                </p>
              )}
              {a.transcricao && (
                <p>
                  <b className="text-white">O que é falado:</b> <span>“{clip(a.transcricao, 200)}”</span>
                </p>
              )}
              {a.origem === 'local' && (
                <p className="rounded-lg border border-amber-400/30 bg-amber-500/5 px-2 py-1.5 text-amber-100">
                  Leitura local: só os dados do arquivo. Gancho, estrutura e falas ficam vazios até você preencher — a IA que assiste o vídeo é a fase futura.
                </p>
              )}
              {corrigindo ? (
                <ViralEditor
                  viral={viral}
                  onClose={() => setCorrigindo(false)}
                  onSalvo={(v) => {
                    setCorrigindo(false);
                    onViralMudou(v);
                  }}
                />
              ) : (
                <p>
                  <button type="button" disabled={desabilitado} onClick={() => setCorrigindo(true)} className={`rounded-full px-3 py-1 text-xs ${T.botaoVidro}`}>
                    <span aria-hidden="true">✎</span> A leitura errou? Corrigir
                  </button>
                </p>
              )}
              <details className="text-[11px] text-zinc-400">
                <summary className="cursor-pointer">log do viral</summary>
                <ul aria-label="Log local do viral" className="mt-1 space-y-1 rounded-xl bg-black/30 p-3 font-mono leading-snug">
                  {log.length === 0 && <li>Sem registros.</li>}
                  {log.map((l) => (
                    <li key={l.id} className={l.level === 'aviso' ? 'text-amber-300' : l.level === 'erro' ? 'text-red-300' : ''}>
                      · {l.message}
                    </li>
                  ))}
                </ul>
              </details>
            </div>
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
