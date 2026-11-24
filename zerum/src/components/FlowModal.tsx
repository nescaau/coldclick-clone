'use client';
import { useState } from 'react';
import { accountLabel } from '@/lib/bridge/accounts';
import type { BridgeStatus } from '@/lib/bridge/status';
import { BASE_PATH } from '@/lib/config.shared';
import { Modal, T } from './ui';

const CHECKS: { chave: keyof BridgeStatus['checklist']; texto: string }[] = [
  { chave: 'extensionInstalled', texto: 'Extensão Zerum instalada' },
  { chave: 'extensionConnected', texto: 'Extensão conectada a este site' },
  { chave: 'flowTabOpen', texto: 'Aba do Flow aberta e logada' },
  { chave: 'accountChosen', texto: 'Conta escolhida sozinha' },
];

interface Props {
  status: BridgeStatus | null;
  /** A "Simulação local" (⚙) está ligada: com o Flow pronto, os lotes ainda seriam simulados. */
  simulacao: boolean;
  /** Desliga a simulação (o usuário confirma com um clique: gerar de verdade gasta crédito do Flow). */
  onDesligarSimulacao: () => Promise<void>;
  onRetry: () => Promise<void>;
  onClose: () => void;
}

/** Diálogo "CONECTAR O FLOW": o estado REAL da ponte e, se faltar algo, o que fazer (com a instalação aqui dentro do app). */
export function FlowModal({ status, simulacao, onDesligarSimulacao, onRetry, onClose }: Props) {
  const [tentando, setTentando] = useState(false);
  const [desligando, setDesligando] = useState(false);
  const checklist = status?.checklist;
  const instalada = !!checklist?.extensionInstalled;
  const contas = status?.accounts ?? [];

  const passos: string[] = !instalada
    ? [
        'Baixe a extensão (botão abaixo) e extraia o ZIP numa pasta permanente.',
        'No Chrome: chrome://extensions → ligue o “Modo do desenvolvedor” → “Carregar sem compactação” → escolha a pasta extraída.',
        'Recarregue esta página (F5).',
        'Abra o Flow pelo ícone da extensão (“Abrir o Flow”), entre na SUA conta Google e abra um projeto.',
      ]
    : status?.originBlocked
      ? [`A extensão está instalada, mas não aceita este endereço. Abra o ícone dela, adicione ${typeof window === 'undefined' ? 'este endereço' : window.location.origin} em “Sites autorizados”, salve e recarregue (F5).`]
      : !checklist?.flowTabOpen
        ? ['Abra o Flow pelo ícone da extensão (“Abrir o Flow”), entre na SUA conta Google e abra (ou crie) um projeto.', 'Volte aqui e clique em “Tentar de novo”.']
        : ['A conta do Flow não pode receber vídeo agora — veja o detalhe abaixo (pausa por cota, geração em conferência ou conta pausada).'];

  return (
    <Modal titulo="CONECTAR O FLOW" onClose={onClose} largura="max-w-xl">
      <div className="space-y-4">
        <div className={`space-y-3 rounded-2xl border p-4 ${status?.ready ? 'border-emerald-400/50 bg-emerald-500/5' : 'border-amber-400/50 bg-amber-500/5'}`}>
          <p className="text-sm font-black text-white" data-estado={status?.ready ? 'conectado' : 'desconectado'}>
            {status?.ready ? '● Conectado' : '○ Não conectado'}
            {status?.version ? <span className="ml-2 font-mono text-[10px] font-normal text-zinc-400">extensão v{status.version}</span> : null}
          </p>

          {status?.ready ? (
            <ul className="space-y-1 text-xs text-white" aria-label="Contas do Flow">
              {contas.map((c) => (
                <li key={`${c.accountId}|${c.projectId}`}>
                  {c.online ? '●' : '○'} {accountLabel(c)}
                  {c.pending ? ` · ${c.pending} em andamento` : ''}
                </li>
              ))}
            </ul>
          ) : (
            <div className="space-y-2 rounded-xl border border-amber-400/40 bg-amber-500/10 p-3">
              <p className="text-sm font-black text-white">O que fazer:</p>
              <ol className="list-decimal space-y-1 pl-5 text-xs text-white">
                {passos.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ol>
              {!instalada && (
                <p className="flex flex-wrap gap-2 pt-1 text-xs">
                  <a href={`${BASE_PATH}/api/extension/package`} className={`rounded-xl px-4 py-2 ${T.botaoClaro}`}>
                    ⬇ Baixar a extensão (.zip)
                  </a>
                  <a href={`${BASE_PATH}/extensao`} className={`rounded-xl px-4 py-2 ${T.botaoVidro}`}>
                    Passo a passo
                  </a>
                </p>
              )}
            </div>
          )}

          {status?.ready && simulacao && (
            <div className="space-y-2 rounded-xl border border-amber-400/40 bg-amber-500/10 p-3 text-xs text-white" data-aviso="simulacao-ligada">
              <p>
                <b>A simulação local (⚙) está ligada:</b> os lotes ainda são simulados (selo SIMULADO) e nada é gerado no Flow. Para gerar de verdade — o que <b>gasta crédito da sua conta do Flow</b> — desligue a simulação.
              </p>
              <button
                type="button"
                disabled={desligando}
                onClick={async () => {
                  setDesligando(true);
                  try {
                    await onDesligarSimulacao();
                  } finally {
                    setDesligando(false);
                  }
                }}
                className={`rounded-xl px-4 py-2 text-sm ${T.botaoClaro}`}
              >
                {desligando ? 'Desligando…' : 'Desligar a simulação e gerar de verdade'}
              </button>
            </div>
          )}
          {status?.ready && !simulacao && <p className="text-xs text-zinc-300">Simulação desligada: os lotes na fila são executados de verdade no Flow, uma cena de cada vez, enquanto esta aba do Zerum estiver aberta.</p>}

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
          Como funciona: uma extensão do Chrome (carregada sem compactação) fala com esta página por <span className="font-mono">window.postMessage</span> e opera o
          flow.google.com na sua própria conta, no seu navegador. Nada da sua conta sai deste computador. Se a extensão não responde em 25 s, o pedido fica preservado e o Zerum nunca gera de novo por conta própria.
        </p>
      </div>
    </Modal>
  );
}
