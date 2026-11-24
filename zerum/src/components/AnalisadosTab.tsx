'use client';
import { useState } from 'react';
import { apiDelete } from '@/lib/client';
import { BASE_PATH } from '@/lib/config.shared';
import { clip, fmtDuration } from '@/lib/domain/analysis';
import type { ViralDTO } from '@/lib/types';
import { Modal, T, fmtDateTime, useTwoClick } from './ui';
import { ViralThumb } from './ViralCard';

interface Props {
  /** null = ainda carregando. */
  virais: ViralDTO[] | null;
  onAtualizar: () => void;
  onUsar: (v: ViralDTO) => void;
}

/** Aba ANALISADOS: "virais que o Diretor já assistiu" (guardados só neste computador). */
export function AnalisadosTab({ virais, onAtualizar, onUsar }: Props) {
  const [assistindo, setAssistindo] = useState<ViralDTO | null>(null);
  const [erro, setErro] = useState('');
  const dois = useTwoClick();

  return (
    <div className={`space-y-4 p-5 ${T.cartao}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className={`text-xl ${T.titulo}`}>ANALISADOS</h2>
          <p className={T.rotulo}>VIRAIS QUE O DIRETOR JÁ ASSISTIU</p>
        </div>
        <button type="button" onClick={onAtualizar} className={`rounded-xl px-3 py-1.5 text-xs ${T.botaoVidro}`}>
          atualizar
        </button>
      </div>

      {erro && <p className="text-sm text-zinc-300">⚠ {erro}</p>}

      {virais === null ? (
        <p className={`text-sm ${T.textoFraco}`}>carregando…</p>
      ) : virais.length === 0 ? (
        <p className={`text-sm ${T.textoFraco}`}>Nenhum viral analisado ainda. Coloque um viral no Diretor — ele fica guardado aqui pra usar de novo sem gastar crédito.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {virais.map((v) => {
            const nome = v.name.replace(/\.mp4$/i, '');
            const meta = [v.durationS !== null ? fmtDuration(v.durationS) : '', fmtDateTime(v.createdAt)].filter(Boolean).join(' · '); // "32 s · 11/23, 07:50 PM"
            return (
              <li key={v.id} className={`flex gap-3 p-3 ${T.cartaoInterno}`}>
                <ViralThumb id={v.id} className="h-36 w-20 !rounded-xl" />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="truncate text-sm font-bold text-white" title={v.name}>
                    {nome}
                  </p>
                  <p className={`font-mono text-[11px] ${T.textoFraco}`}>{meta}</p>
                  {v.gancho && (
                    <p className={`line-clamp-2 text-xs ${T.textoSuave}`}>
                      <b>Gancho:</b> {clip(v.gancho, 200)}
                    </p>
                  )}
                  {v.analysis?.estrutura && (
                    <p className={`line-clamp-2 text-xs ${T.textoFraco}`}>
                      <b>Estrutura:</b> {clip(v.analysis.estrutura, 200)}
                    </p>
                  )}
                  {!v.gancho && !v.analysis?.estrutura && <p className={`text-xs ${T.textoMudo}`}>Leitura local: só os dados do arquivo (corrija no Diretor para preencher).</p>}
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button type="button" onClick={() => onUsar(v)} className={`rounded-xl px-3 py-1.5 text-xs ${T.botaoPrimario}`}>
                      Usar no Diretor
                    </button>
                    <button type="button" data-zerum="analisado-assistir" onClick={() => setAssistindo(v)} className={`rounded-xl px-3 py-1.5 text-xs ${T.botaoVidro}`}>
                      ▶ Assistir
                    </button>
                    <a data-zerum="analisado-baixar" href={`${BASE_PATH}/api/virals/${v.id}/video?download=1`} className={`rounded-xl px-3 py-1.5 text-xs ${T.botaoVidro}`}>
                      ⬇ Baixar
                    </a>
                    <button
                      type="button"
                      onClick={() => {
                        if (!dois.arm(v.id)) return;
                        setErro('');
                        apiDelete(`/virals/${v.id}`)
                          .then(onAtualizar)
                          .catch((e) => setErro(`não consegui apagar (${(e as Error).message})`));
                      }}
                      className={`rounded-xl px-3 py-1.5 text-xs ${dois.armed === v.id ? 'animate-pulse bg-white font-bold text-black' : T.botaoVidro}`}
                    >
                      {dois.armed === v.id ? 'apagar? clique de novo' : 'Apagar'}
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {assistindo && (
        <Modal titulo={`Assistir ${assistindo.name.replace(/\.mp4$/i, '')}`} onClose={() => setAssistindo(null)} largura="max-w-md">
          <video src={`${BASE_PATH}/api/virals/${assistindo.id}/video`} controls autoPlay playsInline className="max-h-[70vh] w-full rounded-xl bg-black" />
        </Modal>
      )}
    </div>
  );
}
