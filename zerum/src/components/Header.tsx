'use client';
import { T } from './ui';

export type Aba = 'diretor' | 'manual' | 'producao' | 'analisados' | 'videos';
/** Avatares e ⚙ abrem como painel lateral por cima do estúdio (como no original). */
export type Gaveta = 'avatares' | 'config' | null;

export const ABAS: { id: Aba; label: string }[] = [
  { id: 'diretor', label: 'DIRETOR' },
  { id: 'manual', label: 'MANUAL' },
  { id: 'producao', label: 'PRODUÇÃO' },
  { id: 'analisados', label: 'ANALISADOS' },
  { id: 'videos', label: 'VÍDEOS' },
];

interface Props {
  aba: Aba;
  gaveta: Gaveta;
  avatares: number;
  onAba: (a: Aba) => void;
  onGaveta: (g: Gaveta) => void;
}

export function Header({ aba, gaveta, avatares, onAba, onGaveta }: Props) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-4 sm:px-6">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/20 bg-white/5 font-mono text-[11px] font-black tracking-wider">
          001
        </div>
        <div>
          <h1 className={`text-xl leading-none ${T.titulo}`}>ZERUM</h1>
          <p className={`mt-1 ${T.rotulo}`}>Gerador e editor automático 001</p>
        </div>
      </div>

      <nav aria-label="Abas do Zerum" className={`flex flex-wrap items-center gap-1 rounded-full p-1 ${T.barra}`}>
        {ABAS.map((a) => {
          const ativa = aba === a.id;
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => onAba(a.id)}
              aria-current={ativa ? 'page' : undefined}
              className={`rounded-full px-4 py-2 text-xs font-black tracking-wider ${ativa ? T.pillAtiva : 'text-zinc-300 hover:text-white'}`}
            >
              {a.label}
            </button>
          );
        })}
      </nav>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onGaveta(gaveta === 'avatares' ? null : 'avatares')}
          aria-expanded={gaveta === 'avatares'}
          className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-xs ${gaveta === 'avatares' ? T.pillAtiva : T.botaoSecundario}`}
        >
          <span>Avatares</span>
          <span>({avatares})</span>
        </button>
        <button
          type="button"
          onClick={() => onGaveta(gaveta === 'config' ? null : 'config')}
          aria-label="Configurações"
          aria-expanded={gaveta === 'config'}
          className={`flex h-9 w-9 items-center justify-center rounded-full text-sm ${gaveta === 'config' ? T.pillAtiva : T.botaoSecundario}`}
        >
          ⚙
        </button>
      </div>
    </header>
  );
}
