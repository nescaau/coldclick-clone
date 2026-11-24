'use client';
import { useState } from 'react';
import type { BridgeStatus } from '@/lib/bridge/status';
import { Modal, T } from './ui';

const CHECKS: { chave: keyof BridgeStatus['checklist']; texto: string }[] = [
  { chave: 'extensionInstalled', texto: 'Extensão Zerum instalada' },
  { chave: 'extensionConnected', texto: 'Extensão conectada a este site' },
  { chave: 'flowTabOpen', texto: 'Aba do Flow aberta e logada' },
  { chave: 'accountChosen', texto: 'Conta escolhida sozinha' },
];

/** Diálogo "CONECTAR O FLOW": checklist da ponte. Nesta fase mostra tudo desligado e explica a fase futura. */
export function FlowModal({ status, onRetry, onClose }: { status: BridgeStatus | null; onRetry: () => Promise<void>; onClose: () => void }) {
  const [tentando, setTentando] = useState(false);
  const checklist = status?.checklist;

  return (
    <Modal titulo="CONECTAR O FLOW" onClose={onClose} largura="max-w-xl">
      <div className="space-y-4">
        <div className="space-y-3 rounded-2xl border border-amber-400/50 bg-amber-500/5 p-4">
          <p className="text-sm font-black text-white">{status?.ready ? '● Conectado' : '○ Não conectado'}</p>
          <p className="text-xs text-white">Nesta versão local do Zerum ainda não existe o executor do Flow.</p>

          <div className="space-y-2 rounded-xl border border-amber-400/40 bg-amber-500/10 p-3">
            <p className="text-sm font-black text-white">O que fazer:</p>
            <ol className="list-decimal space-y-1 pl-5 text-xs text-white">
              <li>Nada por enquanto: virais, conversas, avatares e lotes “preparando” já funcionam localmente.</li>
              <li>A geração real (Flow, pela extensão do clone) é a próxima fase — sem login, sem assinatura e sem Antigravity.</li>
            </ol>
          </div>

          <p className="text-[11px] text-zinc-400">detalhe: {status?.detail ?? '…'}</p>

          <ul className="space-y-1 text-xs text-white">
            {CHECKS.map((c) => (
              <li key={c.chave}>
                {checklist?.[c.chave] ? '✓' : '○'} {c.texto}
              </li>
            ))}
          </ul>

          <button
            type="button"
            disabled={tentando}
            onClick={async () => {
              setTentando(true);
              try {
                await onRetry();
              } finally {
                setTentando(false);
              }
            }}
            className={`rounded-xl px-4 py-2 text-sm ${T.botaoClaro}`}
          >
            {tentando ? 'Tentando…' : 'Tentar de novo'}
          </button>
        </div>

        <p className={`text-xs ${T.textoFraco}`}>
          Como vai ser: uma extensão do Chrome (carregada sem compactação) fala com esta página por <span className="font-mono">window.postMessage</span> e opera o
          flow.google.com na sua própria conta. Se a extensão não responde em 25 s, o pedido fica preservado e o Zerum nunca gera de novo por conta própria.
        </p>
      </div>
    </Modal>
  );
}
