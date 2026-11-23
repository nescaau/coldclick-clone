'use client';
import { T } from './ui';

export type Aba = 'diretor' | 'manual' | 'producao' | 'analisados' | 'videos';
export type Visao = 'estudio' | 'avatares' | 'config';

export const ABAS: { id: Aba; label: string }[] = [
  { id: 'diretor', label: 'DIRETOR' },
  { id: 'manual', label: 'MANUAL' },
  { id: 'producao', label: 'PRODUÇÃO' },
  { id: 'analisados', label: 'ANALISADOS' },
  { id: 'videos', label: 'VÍDEOS' },
];

interface Props {
  aba: Aba;
  visao: Visao;
  onAba: (a: Aba) => void;
  onVisao: (v: Visao) => void;
}

export function Header({ aba, visao, onAba, onVisao }: Props) {
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
          const ativa = visao === 'estudio' && aba === a.id;
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                onVisao('estudio');
                onAba(a.id);
              }}
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
          onClick={() => onVisao(visao === 'avatares' ? 'estudio' : 'avatares')}
          className={`rounded-full px-4 py-2 text-xs ${visao === 'avatares' ? T.pillAtiva : T.botaoSecundario}`}
        >
          Avatares
        </button>
        <button
          type="button"
          onClick={() => onVisao(visao === 'config' ? 'estudio' : 'config')}
          aria-label="Configurações"
          className={`flex h-9 w-9 items-center justify-center rounded-full text-sm ${visao === 'config' ? T.pillAtiva : T.botaoSecundario}`}
        >
          ⚙
        </button>
      </div>
    </header>
  );
}
