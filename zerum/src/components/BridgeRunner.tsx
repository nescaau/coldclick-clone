'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BridgeClient, windowEnv } from '@/lib/bridge/client';
import { ExtensionFlowExecutor } from '@/lib/bridge/executor';
import { BridgePump } from '@/lib/bridge/pump';
import { httpPumpApi } from '@/lib/bridge/pump-api';
import { notInstalledStatus, type BridgeStatus } from '@/lib/bridge/status';
import type { ExecutionMode } from '@/lib/bridge/work';

/** Conta do Flow que o usuário escolheu em "Contas Flow" (e-mail). Só preferência da tela (localStorage). */
export const LS_CONTA_FLOW = 'zerum:conta-flow';
export const lerContaEscolhida = (): string | null => {
  try {
    return localStorage.getItem(LS_CONTA_FLOW);
  } catch {
    return null;
  }
};

export interface PonteInfo {
  /** simulado | real | espera (ver services/bridge-service.ts). */
  modo: ExecutionMode;
  /** Esta aba é a que executa (só uma por vez). */
  lider: boolean;
  /** O que a bomba está esperando (vazio = tudo certo). */
  motivo: string;
}

/**
 * Liga a página à extensão: consulta o estado, informa o servidor e (se esta for a aba líder e a simulação estiver
 * desligada) executa as cenas dos lotes pela ponte. Sem extensão nada disso acontece e o app segue como sempre.
 * Devolve o estado real da ponte para a pílula, o banner, o modal "Conectar o Flow" e o painel "Contas Flow".
 */
export function useBridge(onVideoAndou: () => void) {
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [info, setInfo] = useState<PonteInfo>({ modo: 'espera', lider: false, motivo: '' });
  const pumpRef = useRef<BridgePump | null>(null);
  const pumpId = useRef('');
  const cb = useRef(onVideoAndou);
  cb.current = onVideoAndou;

  useEffect(() => {
    pumpId.current ||= window.crypto.randomUUID(); // novo a cada carregamento (o anterior expira e esta aba assume)
    const client = new BridgeClient(windowEnv(window));
    const ext = new ExtensionFlowExecutor(client, {
      // O relay da extensão marca o <html> assim que a página abre; sem marca = sem extensão (não espera 5 s pela resposta).
      installed: () => document.documentElement.hasAttribute('data-zerum-extension'),
      originBlocked: () => document.documentElement.getAttribute('data-zerum-extension-origin') === 'blocked',
    });
    const pump = new BridgePump({
      api: httpPumpApi,
      ext: ext.api,
      // A extensão nunca derruba a página: resposta fora do formato vira um estado "com erro", não uma exceção.
      status: () => ext.status().catch((e: unknown): BridgeStatus => ({ ...notInstalledStatus(), detail: `EXTENSAO_ERRO; ${e instanceof Error ? e.message : String(e)}`.slice(0, 380), checklist: { extensionInstalled: true, extensionConnected: false, flowTabOpen: false, accountChosen: false } })),
      selectedAccount: lerContaEscolhida,
      pumpId: pumpId.current,
      onProgress: () => cb.current(),
      onStatus: (s, i) => {
        setStatus(s);
        setInfo({ modo: i.mode, lider: i.leader, motivo: i.reason });
      },
      log: (m) => console.info(`[zerum:ponte] ${m}`),
    });
    pumpRef.current = pump;
    // `status()` pode lançar (resposta fora do formato): a página nunca quebra por causa da extensão.
    setStatus(notInstalledStatus());
    pump.start(4_000);
    return () => {
      pump.stop();
      client.dispose();
      pumpRef.current = null;
    };
  }, []);

  /** "Tentar de novo" / "Atualizar contas": uma volta agora, sem esperar o relógio. */
  const atualizar = useCallback(async () => {
    try {
      await pumpRef.current?.tick();
    } catch {
      /* o próximo ciclo tenta de novo */
    }
  }, []);

  return { status, info, atualizar };
}
