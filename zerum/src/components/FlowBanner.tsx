'use client';
import type { BridgeStatus } from '@/lib/bridge/status';
import { accountUsable } from '@/lib/bridge/status';
import { Icon } from './ui';

/**
 * Barra "Conectar o Flow". Sem extensão: o aviso âmbar de sempre (o app funciona sem Flow; só a geração real depende dele).
 * Com a extensão: mostra o estado REAL — conta e créditos quando conectada; o que falta quando não.
 */
export function FlowBanner({ status, onOpen }: { status: BridgeStatus | null; onOpen: () => void }) {
  if (status?.ready) {
    const contas = (status.accounts ?? []).filter((a) => accountUsable(a));
    const principal = [...contas].sort((a, b) => (b.credits ?? -1) - (a.credits ?? -1))[0];
    return (
      <button
        type="button"
        onClick={onOpen}
        data-estado="conectado"
        className="flex w-full items-center gap-4 rounded-2xl border border-emerald-400/40 bg-gradient-to-r from-[#0f1c16] to-[#15151a] px-4 py-3 text-left hover:border-emerald-400/70"
      >
        <Icon name="link" className="text-emerald-300" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-black text-emerald-300">Flow conectado</span>
          <span className="block truncate text-xs text-white">
            {principal ? `${principal.email}${principal.credits != null ? ` · ${principal.credits} créditos` : ''}` : status.detail}
            {contas.length > 1 ? ` · +${contas.length - 1} conta${contas.length === 2 ? '' : 's'}` : ''}
            {status.pending ? ` · ${status.pending} em andamento` : ''}
          </span>
        </span>
        <span className="shrink-0 rounded-xl border border-white/20 px-4 py-2 text-sm font-bold text-white">Ver detalhes</span>
      </button>
    );
  }
  const instalada = !!status?.checklist.extensionInstalled;
  return (
    <button
      type="button"
      onClick={onOpen}
      data-estado={instalada ? 'sem-flow' : 'sem-extensao'}
      className="flex w-full items-center gap-4 rounded-2xl border border-amber-400/40 bg-gradient-to-r from-[#1c1a12] to-[#15151a] px-4 py-3 text-left hover:border-amber-400/70"
    >
      <Icon name="link_off" className="text-amber-300" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-black text-amber-300">Conectar o Flow</span>
        <span className="block text-xs text-white">
          {instalada
            ? 'A extensão está instalada, mas o Flow ainda não está pronto — clique aqui pra ver o que falta.'
            : 'Pode usar o Zerum normalmente. Pra gerar vídeos, conecte o Flow — clique aqui pra ver como.'}
        </span>
      </span>
      <span className="shrink-0 rounded-xl bg-white px-4 py-2 text-sm font-black text-black">Conectar agora →</span>
    </button>
  );
}
