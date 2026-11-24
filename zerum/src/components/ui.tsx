'use client';
import { useEffect, useState, type ReactNode } from 'react';

/** Tokens visuais do tema Zerum (fundo #0a0a0b, vidro branco/5, rótulos mono maiúsculos). Classes completas p/ o Tailwind. */
export const T = {
  cartao: 'bg-white/5 backdrop-blur border border-white/10 rounded-3xl',
  cartaoInterno: 'bg-white/[0.03] border border-white/10 rounded-2xl',
  modal: 'bg-[#0e0e10] border border-white/10 rounded-3xl shadow-[0_0_16px_rgba(255,255,255,.15)]',
  barra: 'bg-white/5 border border-white/10',
  rotulo: 'font-mono uppercase tracking-[0.2em] text-[10px] text-zinc-400',
  titulo: 'font-black uppercase tracking-tight text-white',
  textoSuave: 'text-zinc-300',
  textoFraco: 'text-zinc-400',
  textoMudo: 'text-zinc-500',
  botaoPrimario: 'bg-white text-black font-black hover:bg-zinc-100 disabled:opacity-40 shadow-[0_0_24px_rgba(255,255,255,.25)]',
  botaoSecundario: 'border border-white/20 text-zinc-200 font-bold hover:border-white/60 hover:text-white disabled:opacity-40',
  botaoClaro: 'bg-white text-black font-bold hover:bg-zinc-100 disabled:opacity-40',
  botaoVidro: 'bg-white/10 border border-white/15 text-white font-bold hover:bg-white/15 disabled:opacity-40',
  pillAtiva: 'bg-white text-black border border-white shadow-[0_0_16px_rgba(255,255,255,.15)]',
  opcaoAtiva: 'border border-white bg-white/10 shadow-[0_0_16px_rgba(255,255,255,.15)]',
  opcaoInativa: 'border border-white/10 opacity-70 hover:opacity-100',
  dropOcioso: 'bg-white/5 border-2 border-dashed border-white/20',
  dropArrastando: 'bg-white/10 border-2 border-dashed border-white shadow-[0_0_24px_rgba(255,255,255,.25)]',
  campo: 'bg-black/40 border border-white/10 rounded-xl text-white placeholder:text-zinc-600 focus:border-white/50 focus:outline-none',
  link: 'text-zinc-400 underline hover:text-white',
} as const;

export function Icon({ name, className = '' }: { name: string; className?: string }) {
  return (
    <span className={`material-symbols-outlined ${className}`} aria-hidden="true">
      {name}
    </span>
  );
}

/** Modal simples: fundo escuro, Esc fecha, clique fora fecha. */
export function Modal({
  titulo,
  onClose,
  children,
  largura = 'max-w-2xl',
}: {
  titulo: string;
  onClose: () => void;
  children: ReactNode;
  largura?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="zr-modal-fundo fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto p-4 sm:p-8"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div role="dialog" aria-modal="true" aria-label={titulo} className={`w-full ${largura} p-5 sm:p-6 ${T.modal}`}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className={`text-2xl ${T.titulo}`}>{titulo}</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" className="rounded-lg p-1 text-zinc-400 hover:bg-white/10 hover:text-white">
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const fmtMb = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;

export const fmtDateTime = (iso: string): string => {
  try {
    // "11/23, 07:50 PM": formato en-US de 12 h, o mesmo do LOG e do cartão de ANALISADOS do original (r10-analisados).
    return new Date(iso).toLocaleString('en-US', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
};

/** "09:51:51 PM" — hora do painel LOG (formato en-US de 12 h, como no original). */
export const fmtClock = (iso: string): string => {
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
};

/** "32 s" / "1 min 05 s" não são usados: o original mostra segundos puros. */
export const fmtSeconds = (s: number | null | undefined): string => (s === null || s === undefined ? '' : `${Math.round(s)} s`);

/**
 * Confirmação por 2º clique (padrão do original: "clique de novo", volta sozinho em 6 s).
 * `arm(key)` arma; devolve true se `key` já estava armado (= confirmou).
 */
export function useTwoClick(ms = 6000): { armed: string; arm: (key: string) => boolean; reset: () => void } {
  const [armed, setArmed] = useState('');
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(''), ms);
    return () => clearTimeout(t);
  }, [armed, ms]);
  return {
    armed,
    arm: (key) => {
      if (armed === key) {
        setArmed('');
        return true;
      }
      setArmed(key);
      return false;
    },
    reset: () => setArmed(''),
  };
}

/** Painel lateral direito (Avatares e ⚙ no original): cobre a lateral, Esc fecha. */
export function Drawer({ titulo, onClose, children }: { titulo: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <aside
      role="dialog"
      aria-label={titulo}
      className="fixed inset-y-0 right-0 z-[75] flex w-[min(26rem,100vw)] flex-col border-l border-white/10 bg-[#0e0e10] shadow-[0_0_40px_rgba(0,0,0,.6)]"
    >
      <div className="flex items-center justify-between px-5 py-3">
        <span className={T.rotulo}>{titulo}</span>
        <button type="button" onClick={onClose} aria-label="Fechar" className="rounded-lg p-1 text-zinc-400 hover:bg-white/10 hover:text-white">
          <Icon name="close" />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 pb-8">{children}</div>
    </aside>
  );
}
