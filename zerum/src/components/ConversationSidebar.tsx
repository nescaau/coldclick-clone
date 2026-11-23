'use client';
import { useState } from 'react';
import { formatHour, MODE_EMOJI } from '@/lib/domain/director';
import type { ConversationSummary } from '@/lib/types';
import { Icon, T } from './ui';

interface Props {
  itens: ConversationSummary[];
  atual: string;
  ocupado: boolean;
  onAbrir: (id: string) => void;
  onNova: () => void;
  onRenomear: (id: string, titulo: string) => void;
  onApagar: (id: string) => void;
}

/** Painel lateral "CONVERSAS" com "+ Nova conversa". */
export function ConversationSidebar({ itens, atual, ocupado, onAbrir, onNova, onRenomear, onApagar }: Props) {
  const [editando, setEditando] = useState<string | null>(null);
  const [texto, setTexto] = useState('');

  const salvar = (id: string) => {
    const t = texto.trim();
    setEditando(null);
    if (t) onRenomear(id, t);
  };

  return (
    <aside aria-label="Conversas" className={`flex flex-col gap-2 p-3 ${T.cartao}`}>
      <button type="button" onClick={onNova} disabled={ocupado} className={`w-full rounded-xl px-3 py-2 text-sm font-black ${T.botaoSecundario}`}>
        + Nova conversa
      </button>
      <span className={`px-2 pt-1 ${T.rotulo}`}>Conversas</span>
      <div className="-mx-1 flex max-h-[60vh] min-h-0 flex-col gap-1 overflow-y-auto px-1">
        {itens.map((c) => {
          const ativa = c.id === atual;
          return (
            <div
              key={c.id}
              className={`group relative rounded-xl border px-2 py-2 ${ativa ? 'border-white/30 bg-white/10' : 'border-transparent hover:bg-white/5'}`}
            >
              {editando === c.id ? (
                <input
                  autoFocus
                  value={texto}
                  maxLength={80}
                  aria-label="Renomear conversa"
                  onChange={(e) => setTexto(e.target.value)}
                  onBlur={() => salvar(c.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') salvar(c.id);
                    if (e.key === 'Escape') setEditando(null);
                  }}
                  className={`w-full px-2 py-1 text-xs ${T.campo}`}
                />
              ) : (
                <button type="button" onClick={() => onAbrir(c.id)} disabled={ocupado} className="block w-full text-left">
                  <span className="block truncate pr-10 text-xs font-bold text-white">{c.title}</span>
                  <span className="block text-[10px] text-zinc-400">
                    {formatHour(c.updatedAt)} · {MODE_EMOJI[c.mode]}
                  </span>
                </button>
              )}
              {editando !== c.id && (
                <span className="absolute right-1 top-1.5 hidden gap-0.5 group-hover:flex group-focus-within:flex">
                  <button
                    type="button"
                    aria-label="Renomear"
                    title="Renomear"
                    disabled={ocupado}
                    onClick={() => {
                      setTexto(c.title);
                      setEditando(c.id);
                    }}
                    className="rounded p-0.5 text-zinc-400 hover:text-white"
                  >
                    <Icon name="edit" className="!text-[16px]" />
                  </button>
                  <button
                    type="button"
                    aria-label="Apagar"
                    title="Apagar"
                    disabled={ocupado}
                    onClick={() => confirm(`Apagar a conversa “${c.title}”?`) && onApagar(c.id)}
                    className="rounded p-0.5 text-zinc-400 hover:text-white"
                  >
                    <Icon name="delete" className="!text-[16px]" />
                  </button>
                </span>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
