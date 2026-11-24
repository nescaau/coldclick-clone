'use client';
import { useEffect, useState } from 'react';
import { apiDelete, apiGet, apiPost } from '@/lib/client';
import { BASE_PATH } from '@/lib/config.shared';
import { pathLabel, variationLabel } from '@/lib/domain/plan';
import { VIDEO_STATE_LABEL } from '@/lib/domain/production';
import { languageName } from '@/lib/domain/video-options';
import type { BatchDTO, EventDTO, VideoDTO } from '@/lib/types';
import { LogPanel } from './LogPanel';
import { T, fmtClock, useTwoClick } from './ui';

interface Props {
  lotes: BatchDTO[];
  onMudou: () => void;
  onAbrirVideos: () => void;
}

const ativo = (b: BatchDTO) => b.state === 'rodando' || b.state === 'na_fila' || b.state === 'preparando';
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const COR_CENA = { pronto: 'bg-emerald-400', gerando: 'animate-pulse bg-white', fila: 'bg-white/15', falhou: 'bg-red-400' } as const;

function VideoLinha({ v, lote, onAcao }: { v: VideoDTO; lote: BatchDTO; onAcao: (fn: () => Promise<unknown>) => void }) {
  const dois = useTwoClick();
  const emAndamento = v.state === 'fila' || v.state === 'gerando';
  const etapa =
    v.state === 'gerando'
      ? `gerando · cena ${Math.min(v.scenesDone + 1, v.scenesTotal)}/${v.scenesTotal}`
      : v.state === 'falhou'
        ? `FALHOU — ${v.error}`
        : v.state === 'cancelado'
          ? v.error || 'cancelado'
          : VIDEO_STATE_LABEL[v.state];
  return (
    <li className="space-y-1.5 rounded-xl border border-white/10 bg-black/20 p-3" data-estado={v.state}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-black text-white">vídeo {v.idx + 1}</span>
        {v.avatarName && <span className={`text-[11px] ${T.textoFraco}`}>🎯 {v.avatarName}</span>}
        <span className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ${v.state === 'falhou' ? 'border-red-400/60 text-red-300' : v.state === 'pronto' ? 'border-emerald-400/60 text-emerald-300' : 'border-white/20 text-zinc-300'}`}>
          {VIDEO_STATE_LABEL[v.state]}
        </span>
        {v.state === 'pronto' && v.simulated && <span className="rounded bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-black text-amber-200">SIMULADO</span>}
        {v.state === 'pronto' && !v.simulated && <span className="rounded bg-emerald-400/15 px-1.5 py-0.5 text-[10px] font-black text-emerald-200">FLOW</span>}
      </div>
      {v.scenes[0] && <p className="text-xs italic text-zinc-300">“{cut(v.scenes[0].fala, 140)}”</p>}
      <div className="flex items-center gap-1" role="list" aria-label={`Cenas do vídeo ${v.idx + 1}`}>
        {v.scenes.map((s, i) => (
          <span key={i} role="listitem" title={`cena ${i + 1} · ${s.state}`} aria-label={`cena ${i + 1}: ${s.state}`} className={`h-2 flex-1 rounded-full ${COR_CENA[s.state]}`} />
        ))}
      </div>
      <p className={`text-xs ${v.state === 'falhou' ? 'text-red-300' : T.textoFraco}`}>
        {v.state === 'pronto' ? 'PRONTO' : etapa}
        {v.state === 'pronto' && ` · ${v.scenesTotal} cena${v.scenesTotal === 1 ? '' : 's'}`}
      </p>
      <div className="flex flex-wrap gap-2">
        {v.state === 'pronto' && (
          <a href={`${BASE_PATH}/api/videos/${v.id}/download`} className={`rounded-xl px-3 py-1 text-xs ${T.botaoVidro}`}>
            ⬇ Baixar MP4
          </a>
        )}
        {v.state === 'falhou' && (
          <button type="button" onClick={() => onAcao(() => apiPost(`/videos/${v.id}/retry`))} title="Tenta novamente as cenas que falharam; as cenas prontas ficam preservadas" className={`rounded-xl px-3 py-1 text-xs ${T.botaoVidro}`}>
            ↻ Tentar de novo
          </button>
        )}
        {!emAndamento && (
          <button
            type="button"
            title={dois.armed === v.id ? 'Sai da Produção e de Vídeos' : undefined}
            onClick={() => {
              if (dois.arm(v.id)) onAcao(() => apiDelete(`/videos/${v.id}`));
            }}
            className={`rounded-xl px-3 py-1 text-xs ${dois.armed === v.id ? 'bg-white font-bold text-black' : T.botaoVidro}`}
          >
            {dois.armed === v.id ? 'clique de novo para descartar este vídeo (sai da Produção e de Vídeos)' : '✕ Descartar vídeo'}
          </button>
        )}
      </div>
      <span className="sr-only">{lote.title}</span>
    </li>
  );
}

function LoteCard({ lote, onMudou }: { lote: BatchDTO; onMudou: () => void }) {
  const [log, setLog] = useState<EventDTO[] | null>(null);
  const [verLog, setVerLog] = useState(false);
  const [erro, setErro] = useState('');
  const dois = useTwoClick();
  const on = ativo(lote);
  const prontos = lote.videos.filter((v) => v.state === 'pronto').length;
  const falhas = lote.videos.filter((v) => v.state === 'falhou').length;
  const total = lote.videos.length;
  const titulo = cut(lote.title, 40);
  const cenasTotal = lote.videos.reduce((n, v) => n + v.scenesTotal, 0);
  const cenasFeitas = lote.videos.reduce((n, v) => n + (v.state === 'pronto' ? v.scenesTotal : v.scenesDone), 0);

  // Log em tempo real: relê enquanto aberto (a cada 1,5 s se o lote está ativo).
  useEffect(() => {
    if (!verLog) return;
    let vivo = true;
    const ler = () =>
      apiGet<EventDTO[]>(`/batches/${lote.id}`)
        .then((l) => vivo && setLog(l))
        .catch((e) => vivo && setErro((e as Error).message));
    void ler();
    const t = on ? setInterval(ler, 1500) : undefined;
    return () => {
      vivo = false;
      if (t) clearInterval(t);
    };
  }, [verLog, lote.id, on, lote.updatedAt]);

  const acao = async (fn: () => Promise<unknown>) => {
    setErro('');
    try {
      await fn();
      onMudou();
    } catch (e) {
      setErro((e as Error).message);
    }
  };

  const estado = lote.state === 'rodando' ? 'gerando agora' : lote.state === 'na_fila' ? 'na fila' : lote.state === 'parado' ? 'parado' : lote.state === 'cancelado' ? 'cancelado' : lote.state === 'falhou' ? 'terminou com falha' : 'pronto';

  return (
    <li className={`space-y-3 p-4 ${T.cartaoInterno}`} data-lote={lote.id} data-estado={lote.state}>
      <div className="space-y-1">
        <p className="text-sm text-white">
          <b data-zerum="apelido-lote">{lote.batchName ? `${lote.batchName} · ` : ''}</b>
          <span className="font-black">{total} vídeo{total === 1 ? '' : 's'}</span> · {estado} · {prontos}/{total} prontos
        </p>
        <p className={`truncate text-xs ${T.textoFraco}`}>
          {lote.title} · {pathLabel(lote.path)} · {variationLabel(lote.variation).toLowerCase()} · {languageName(lote.language)} ·{' '}
          {lote.viralName ? `viral “${lote.viralName.replace(/\.mp4$/i, '')}”` : 'sem viral'}
        </p>
        {cenasTotal > 0 && (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={cenasTotal} aria-valuenow={cenasFeitas} aria-label="Cenas prontas do lote">
            <div className="h-full rounded-full bg-white transition-all" style={{ width: `${Math.round((cenasFeitas / cenasTotal) * 100)}%` }} />
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        {(lote.state === 'rodando' || lote.state === 'na_fila') && (
          <button type="button" disabled={lote.stopRequested} onClick={() => void acao(() => apiPost(`/batches/${lote.id}/stop`))} className={`rounded-xl px-3 py-1.5 text-xs ${T.botaoVidro}`}>
            {lote.stopRequested ? 'Parando após os atuais…' : 'Parar depois dos atuais'}
          </button>
        )}
        {lote.state === 'parado' && (
          <button type="button" onClick={() => void acao(() => apiPost(`/batches/${lote.id}/resume`))} className={`rounded-xl px-3 py-1.5 text-xs ${T.botaoPrimario}`}>
            Continuar de onde parou
          </button>
        )}
        {(on || lote.state === 'parado') && (
          <button
            type="button"
            data-acao="cancelar"
            title="Esvazia a fila deste lote agora; o que o Flow ainda devolver é ignorado. As cenas já prontas ficam guardadas. Pede 2º clique para confirmar."
            onClick={() => {
              if (dois.arm('cancelar')) void acao(() => apiPost(`/batches/${lote.id}/cancel`));
            }}
            className={`rounded-xl px-3 py-1.5 text-xs ${dois.armed === 'cancelar' ? 'animate-pulse bg-white font-bold text-black' : T.botaoVidro}`}
          >
            {dois.armed === 'cancelar' ? `✕ Confirmar: cancelar "${titulo}"?` : '✕ Cancelar agora'}
          </button>
        )}
        {falhas > 0 && (
          <button type="button" title="Só as cenas que faltam são geradas; as prontas ficam (0 crédito)" onClick={() => void acao(() => apiPost(`/batches/${lote.id}/retry`, {}))} className={`rounded-xl px-3 py-1.5 text-xs ${T.botaoVidro}`}>
            ↻ Regerar todas as cenas com falha ({falhas})
          </button>
        )}
        {prontos > 0 ? (
          <a href={`${BASE_PATH}/api/batches/${lote.id}/zip`} className={`rounded-xl px-3 py-1.5 text-xs ${T.botaoVidro}`}>
            Baixar todos os prontos ({prontos})
          </a>
        ) : (
          <button type="button" disabled className={`rounded-xl px-3 py-1.5 text-xs ${T.botaoVidro}`}>
            Baixar todos os prontos (0)
          </button>
        )}
        {!on && lote.state !== 'parado' && (
          <button type="button" title="Tira este lote da Produção. Os vídeos prontos ficam em Vídeos." onClick={() => void acao(() => apiPost(`/batches/${lote.id}/approve`))} className={`rounded-xl px-3 py-1.5 text-xs ${T.botaoPrimario}`}>
            ✓ Aprovar lote → Vídeos
          </button>
        )}
        <button
          type="button"
          data-acao="descartar"
          title="O contrário do Aprovar: tira o lote da Produção sem guardar nada em Vídeos e apaga as cenas guardadas deste lote. Se estiver gerando, cancela antes. Pede 2º clique."
          onClick={() => {
            if (dois.arm('descartar')) void acao(() => apiDelete(`/batches/${lote.id}`));
          }}
          className={`rounded-xl px-3 py-1.5 text-xs ${dois.armed === 'descartar' ? 'animate-pulse bg-white font-bold text-black' : T.botaoVidro}`}
        >
          {dois.armed === 'descartar' ? `✕ Confirmar: descartar "${titulo}"?` : '✕ Descartar lote'}
        </button>
      </div>
      {dois.armed === 'descartar' && <p className="text-xs text-amber-200">Clique de novo em "Confirmar" para DESCARTAR "{titulo}" — nada vai pra Vídeos e as cenas guardadas deste lote são apagadas.</p>}
      {dois.armed === 'cancelar' && <p className="text-xs text-amber-200">Clique de novo em "Confirmar" para cancelar este lote ("{titulo}").</p>}

      {erro && (
        <p role="alert" className="text-xs text-zinc-200">
          ⚠ {erro}
        </p>
      )}

      <ul className="space-y-2" aria-label={`Vídeos do lote ${lote.title}`}>
        {lote.videos.map((v) => (
          <VideoLinha key={v.id} v={v} lote={lote} onAcao={(fn) => void acao(fn)} />
        ))}
      </ul>

      <button type="button" onClick={() => setVerLog((v) => !v)} aria-expanded={verLog} className={`text-xs ${T.link}`}>
        {verLog ? 'esconder log' : 'ver log'}
      </button>
      {verLog && (
        <ul aria-label="Log local do lote" className="max-h-64 space-y-1 overflow-y-auto rounded-xl bg-black/30 p-3 font-mono text-[11px] leading-snug text-zinc-400">
          {(log ?? []).map((l) => (
            <li key={l.id} className={l.level === 'aviso' ? 'text-amber-300' : l.level === 'erro' ? 'text-red-300' : ''}>
              <span className="text-zinc-500">{fmtClock(l.createdAt)}</span> {l.message}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** Aba PRODUÇÃO: lotes com vídeos, cenas e progresso (ou o estado vazio literal do original). */
export function ProducaoTab({ lotes, onMudou, onAbrirVideos }: Props) {
  if (lotes.length === 0) {
    return (
      <div className="space-y-4">
        <div className={`space-y-2 p-6 ${T.cartao}`}>
          <p className={`text-lg ${T.titulo}`}>Nada em produção agora.</p>
          <p className={`text-sm ${T.textoSuave}`}>
            Monte um lote no <b className="text-white">Diretor</b> (conversando) ou no <b className="text-white">Manual</b> (<b className="text-white">viral</b> → caminho → quem aparece → Gerar). Ele aparece aqui enquanto roda; cada vídeo pronto entra em Vídeos.
          </p>
        </div>
        <LogPanel />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className={`space-y-4 p-5 ${T.cartao}`}>
        <ul className="space-y-3">
          {lotes.map((l) => (
            <LoteCard key={l.id} lote={l} onMudou={onMudou} />
          ))}
        </ul>
        <p className={`text-xs ${T.textoFraco}`}>
          Cada vídeo pronto entra em{' '}
          <button type="button" onClick={onAbrirVideos} className={T.link}>
            Vídeos
          </button>
          .
        </p>
      </div>
      <LogPanel />
    </div>
  );
}
