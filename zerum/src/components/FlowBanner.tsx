'use client';
import { Icon } from './ui';

/** Aviso âmbar "Conectar o Flow": o app funciona sem Flow; só a geração real (fase futura) depende dele. */
export function FlowBanner({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-4 rounded-2xl border border-amber-400/40 bg-gradient-to-r from-[#1c1a12] to-[#15151a] px-4 py-3 text-left hover:border-amber-400/70"
    >
      <Icon name="link_off" className="text-amber-300" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-black text-amber-300">Conectar o Flow</span>
        <span className="block text-xs text-white">
          Pode usar o Zerum normalmente. Pra gerar vídeos, conecte o Flow — clique aqui pra ver como.
        </span>
      </span>
      <span className="shrink-0 rounded-xl bg-white px-4 py-2 text-sm font-black text-black">Conectar agora →</span>
    </button>
  );
}
