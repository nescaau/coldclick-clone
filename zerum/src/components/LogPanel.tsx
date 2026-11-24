'use client';
import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/client';
import type { EventDTO } from '@/lib/types';
import { T, fmtClock } from './ui';

/** "DETALHES TÉCNICOS (LOG)": log geral do app (persistido em `events`), da linha mais nova para a mais antiga. */
export function LogPanel({ tick }: { tick?: number }) {
  const [aberto, setAberto] = useState(false);
  const [linhas, setLinhas] = useState<EventDTO[]>([]);

  useEffect(() => {
    if (!aberto) return;
    let vivo = true;
    const carregar = () =>
      apiGet<EventDTO[]>('/log')
        .then((l) => vivo && setLinhas(l))
        .catch(() => undefined);
    void carregar();
    const t = setInterval(carregar, 3000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [aberto, tick]);

  return (
    <details open={aberto} onToggle={(e) => setAberto((e.currentTarget as HTMLDetailsElement).open)} className={`${T.cartaoInterno} px-4 py-3`}>
      <summary className={`cursor-pointer ${T.rotulo}`}>DETALHES TÉCNICOS (LOG)</summary>
      <div className="mt-3 space-y-2">
        <h3 className="text-xs font-black text-white">LOG</h3>
        <ul aria-label="Log do app" className="space-y-1 font-mono text-[11px] leading-snug text-zinc-400">
          {linhas.length === 0 && <li>Sem registros.</li>}
          {linhas.map((l) => (
            <li key={l.id} className={l.level === 'aviso' ? 'text-amber-300' : l.level === 'erro' ? 'text-red-300' : ''}>
              <span className="text-zinc-500">{fmtClock(l.createdAt)}</span> {l.message}
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
