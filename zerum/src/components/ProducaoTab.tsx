'use client';
import { useState } from 'react';
import { apiDelete, apiGet, apiPost } from '@/lib/client';
import { languageName } from '@/lib/domain/video-options';
import type { BatchDTO, EventDTO } from '@/lib/types';
import { T, fmtDateTime } from './ui';

interface Props {
  lotes: BatchDTO[];
  onMudou: () => void;
}

function LoteCard({ lote, onMudou }: { lote: BatchDTO; onMudou: () => void }) {
  const [log, setLog] = useState<EventDTO[] | null>(null);
  const [erro, setErro] = useState('');

  const alternarLog = async () => {
    if (log) return setLog(null);
    try {
      setLog(await apiGet<EventDTO[]>(`/batches/${lote.id}`));
    } catch (e) {
      setErro((e as Error).message);
    }
  };
  const acao = async (fn: () => Promise<unknown>) => {
    setErro('');
    try {
      await fn();
      setLog(null);
      onMudou();
    } catch (e) {
      setErro((e as Error).message);
    }
  };

  return (
    <li className={`space-y-3 p-4 ${T.cartaoInterno}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-black text-white">{lote.title}</p>
          <p className={`text-xs ${T.textoFraco}`}>
            {lote.quantity} vídeo{lote.quantity === 1 ? '' : 's'} · {languageName(lote.language)} · {lote.viralName ? `viral “${lote.viralName.replace(/\.mp4$/i, '')}”` : 'sem viral'} ·{' '}
            {fmtDateTime(lote.createdAt)}
          </p>
        </div>
        <span className={`rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-widest ${lote.state === 'cancelado' ? 'border-white/10 text-zinc-500' : 'border-white/40 text-white'}`}>
          {lote.state}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={alternarLog} aria-expanded={!!log} className={`text-xs ${T.link}`}>
          {log ? 'esconder log' : 'ver log'}
        </button>
        {lote.state === 'preparando' && (
          <button type="button" onClick={() => acao(() => apiPost(`/batches/${lote.id}/cancel`))} className={`rounded-xl px-3 py-1.5 text-xs ${T.botaoVidro}`}>
            Cancelar lote
          </button>
        )}
        {(lote.state === 'cancelado' || lote.state === 'preparando') && (
          <button
            type="button"
            onClick={() => lote.state === 'cancelado' && acao(() => apiDelete(`/batches/${lote.id}`))}
            disabled={lote.state !== 'cancelado'}
            title={lote.state === 'cancelado' ? 'Apagar este lote' : 'Cancele o lote antes de apagar'}
            className={`rounded-xl px-3 py-1.5 text-xs ${T.botaoVidro}`}
          >
            Apagar
          </button>
        )}
      </div>
      {erro && (
        <p role="alert" className="text-xs text-zinc-200">
          ⚠ {erro}
        </p>
      )}
      {log && (
        <ul aria-label="Log local do lote" className="space-y-1 rounded-xl bg-black/30 p-3 font-mono text-[11px] leading-snug text-zinc-400">
          {log.map((l) => (
            <li key={l.id} className={l.level === 'aviso' ? 'text-amber-300' : l.level === 'erro' ? 'text-red-300' : ''}>
              {fmtDateTime(l.createdAt)} · {l.message}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** Aba PRODUÇÃO: lotes em andamento (nesta fase, só "preparando") ou o estado vazio do original. */
export function ProducaoTab({ lotes, onMudou }: Props) {
  const emProducao = lotes.filter((l) => l.state !== 'pronto');
  if (emProducao.length === 0) {
    return (
      <div className={`space-y-2 p-6 ${T.cartao}`}>
        <p className={`text-lg ${T.titulo}`}>Nada em produção agora.</p>
        <p className={`text-sm ${T.textoSuave}`}>
          Monte um lote no <b className="text-white">Diretor</b> (conversando) ou no <b className="text-white">Manual</b> (viral → caminho → quem aparece →
          Gerar). Ele aparece aqui enquanto roda; cada vídeo pronto entra em Vídeos.
        </p>
      </div>
    );
  }
  return (
    <div className={`space-y-4 p-5 ${T.cartao}`}>
      <h2 className={`text-xl ${T.titulo}`}>PRODUÇÃO</h2>
      <p className={`text-xs ${T.textoFraco}`}>
        Versão local: os lotes ficam em “preparando” — a geração real (Flow, pela extensão) é a próxima fase e nada é enviado a lugar nenhum.
      </p>
      <ul className="space-y-3">
        {emProducao.map((l) => (
          <LoteCard key={l.id} lote={l} onMudou={onMudou} />
        ))}
      </ul>
    </div>
  );
}
