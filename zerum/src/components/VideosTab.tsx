'use client';
import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/client';
import { BASE_PATH } from '@/lib/config.shared';
import type { VideoDTO } from '@/lib/types';
import { T, fmtDateTime } from './ui';

interface Grupo {
  batchId: string;
  title: string;
  createdAt: string;
  videos: VideoDTO[];
}

/** Aba VÍDEOS ("MEUS VÍDEOS"): só os vídeos finais, organizados por lote (o mais novo primeiro), com download. */
export function VideosTab({ tick }: { tick?: number }) {
  const [grupos, setGrupos] = useState<Grupo[] | null>(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    let vivo = true;
    const ler = () =>
      apiGet<Grupo[]>('/videos')
        .then((g) => vivo && setGrupos(g))
        .catch((e) => vivo && setErro((e as Error).message));
    void ler();
    const t = setInterval(ler, 3000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [tick]);

  return (
    <div className={`space-y-4 p-6 ${T.cartao}`}>
      <div className="space-y-1">
        <h2 className={`text-xl ${T.titulo}`}>MEUS VÍDEOS</h2>
        <p className={`text-sm ${T.textoSuave}`}>
          Só os vídeos finais, prontos pra postar, <span>organizados por lote (o mais novo primeiro)</span>. Eles ficam na galeria do Flow; esta lista volta com a sua memória. Em <b className="text-white">Editar</b> você corta, troca a fala, regrava só uma cena ou muda a legenda — sai uma versão nova e a anterior fica.
        </p>
      </div>

      {erro && <p className="text-sm text-zinc-300">⚠ {erro}</p>}

      {grupos !== null && grupos.length === 0 && <p className={`text-sm ${T.textoFraco}`}>Nenhum vídeo pronto ainda. Os vídeos que você gerar no Lote aparecem aqui sozinhos.</p>}

      {(grupos ?? []).map((g) => (
        <section key={g.batchId} aria-label={`Lote ${g.title}`} className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-black text-white">
              <span>lote</span> {g.title} · {g.videos.length} vídeo{g.videos.length === 1 ? '' : 's'}
            </h3>
            <span className={`font-mono text-[11px] ${T.textoMudo}`}>{fmtDateTime(g.createdAt)}</span>
            <a href={`${BASE_PATH}/api/batches/${g.batchId}/zip`} className={`rounded-xl px-3 py-1 text-xs ${T.botaoVidro}`}>
              Baixar todos os prontos ({g.videos.length})
            </a>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {g.videos.map((v) => (
              <li key={v.id} className={`space-y-2 p-3 ${T.cartaoInterno}`} data-estado={v.state}>
                <video src={`${BASE_PATH}/api/videos/${v.id}/download?inline=1#t=0.1`} controls preload="metadata" playsInline className="aspect-[9/16] max-h-64 w-full rounded-xl bg-black object-contain" />
                <p className="truncate text-sm font-bold text-white" title={v.title}>
                  {v.title}
                </p>
                <p className={`font-mono text-[11px] ${T.textoFraco}`}>
                  {v.downloadName} · {v.scenesTotal} cena{v.scenesTotal === 1 ? '' : 's'} · {v.finishedAt ? fmtDateTime(v.finishedAt) : ''}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-black text-amber-200" title="Nesta fase o arquivo é uma cópia do viral (ou um clipe de teste), não uma geração real.">
                    SIMULADO
                  </span>
                  <a href={`${BASE_PATH}/api/videos/${v.id}/download`} className={`rounded-xl px-3 py-1 text-xs ${T.botaoVidro}`}>
                    ⬇ Baixar MP4
                  </a>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
