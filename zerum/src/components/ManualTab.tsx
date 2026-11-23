'use client';
import { useState } from 'react';
import { apiPost } from '@/lib/client';
import { MAX_QUANTITY } from '@/lib/limits';
import type { BatchDTO, VideoOptions, ViralDTO } from '@/lib/types';
import { T } from './ui';

interface Props {
  virais: ViralDTO[];
  /** Opções da conversa aberta no Diretor (palavra, nome do lote, balão, cor, idioma). */
  opcoes: VideoOptions | null;
  onCriado: (b: BatchDTO) => void;
}

/** Aba MANUAL: monta um lote sem o Diretor (viral → quantidade → Gerar). Gerar = lote "preparando" (sem executor). */
export function ManualTab({ virais, opcoes, onCriado }: Props) {
  const [viralId, setViralId] = useState('');
  const [qtd, setQtd] = useState(1);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  const gerar = async () => {
    setErro('');
    setEnviando(true);
    try {
      onCriado(await apiPost<BatchDTO>('/batches', { viralId, quantity: qtd, options: opcoes ?? {} }));
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className={`max-w-3xl space-y-5 p-6 ${T.cartao}`}>
      <div>
        <h2 className={`text-2xl ${T.titulo}`}>MANUAL</h2>
        <p className={`mt-1 text-sm ${T.textoSuave}`}>
          Sem conversa: escolha o viral e a quantidade. As opções do vídeo (palavra, nome do lote, balão, cor e idioma) são as da conversa aberta no
          Diretor.
        </p>
      </div>

      <div className="space-y-2">
        <span className={T.rotulo}>1. Qual viral?</span>
        {virais.length === 0 ? (
          <p className={`text-sm ${T.textoFraco}`}>Nenhum viral enviado ainda. Arraste um vídeo no Diretor — ele fica guardado em Analisados.</p>
        ) : (
          <select
            aria-label="Viral do lote"
            value={viralId}
            onChange={(e) => setViralId(e.target.value)}
            className={`w-full px-3 py-2 text-sm ${T.campo} bg-[#0e0e10]`}
          >
            <option value="">Escolha um viral…</option>
            {virais.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name.replace(/\.mp4$/i, '')}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="space-y-2">
        <span className={T.rotulo}>2. Quantos vídeos?</span>
        <input
          type="number"
          aria-label="Quantidade de vídeos"
          min={1}
          max={MAX_QUANTITY}
          value={qtd}
          onChange={(e) => setQtd(Math.max(1, Math.min(MAX_QUANTITY, Number(e.target.value) || 1)))}
          className={`w-28 px-3 py-2 text-sm ${T.campo}`}
        />
      </div>

      {erro && (
        <p role="alert" className="text-sm text-zinc-200">
          ⚠ {erro}
        </p>
      )}
      <button
        type="button"
        onClick={gerar}
        disabled={!viralId || enviando}
        className={`rounded-2xl px-8 py-4 text-base ${T.botaoPrimario}`}
      >
        GERAR {qtd} vídeo{qtd === 1 ? '' : 's'}
      </button>
      <p className={`text-xs ${T.textoFraco}`}>Nesta versão local “gerar” cria o lote em PRODUÇÃO como “preparando”; a geração real é a próxima fase.</p>
    </div>
  );
}
