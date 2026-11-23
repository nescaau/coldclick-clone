'use client';
import { useMemo, useState } from 'react';
import type { ViralDTO } from '@/lib/types';
import { Modal, T, fmtDateTime, fmtMb } from './ui';

interface Props {
  virais: ViralDTO[];
  atualId: string | null;
  onUsar: (v: ViralDTO) => void;
  onClose: () => void;
}

/** "↺ Usar um viral que você já enviou": lista (com busca) dos virais guardados localmente. */
export function ViralPicker({ virais, atualId, onUsar, onClose }: Props) {
  const [busca, setBusca] = useState('');
  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return q ? virais.filter((v) => v.name.toLowerCase().includes(q)) : virais;
  }, [virais, busca]);

  return (
    <Modal titulo="Usar um viral que você já enviou" onClose={onClose}>
      <input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar pelo nome"
        aria-label="Buscar viral"
        className={`mb-3 w-full px-3 py-2 text-sm ${T.campo}`}
      />
      {lista.length === 0 ? (
        <p className={`text-sm ${T.textoFraco}`}>
          {virais.length ? 'Nada com essa busca.' : 'Nenhum viral aqui ainda. Todo viral que você mandar pro Diretor fica guardado nesta lista.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {lista.map((v) => (
            <li key={v.id} className={`flex items-center gap-3 p-3 ${T.cartaoInterno}`}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-white">{v.name.replace(/\.mp4$/i, '')}</p>
                <p className={`text-xs ${T.textoFraco}`}>
                  {fmtMb(v.sizeBytes)} · {fmtDateTime(v.createdAt)}
                </p>
              </div>
              <button type="button" onClick={() => onUsar(v)} className={`shrink-0 rounded-xl px-3 py-1.5 text-xs ${T.botaoVidro}`}>
                {v.id === atualId ? 'em uso' : 'usar nesta conversa'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
