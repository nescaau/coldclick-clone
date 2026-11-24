/** Liga o worker da aba do Flow ao navegador real (DOM + chrome.*). Chamado pelo flow-loader.js. */
import { createDomPage } from '../drivers/dom-page.js';
import { createFlowDriver } from '../drivers/flow-driver.js';
import { SETTINGS_KEY } from '../lib/protocol.js';
import { createFlowWorker } from './flow-worker.js';

export const WORKER_KEY = 'zerum-flow-worker-v1';

/**
 * "Duplicar aba" copia o sessionStorage → dois executores com o mesmo id (furaria CONTA_JA_TEM_ABA_EXECUTORA e as duas abas
 * sobrescreveriam `zr:journal:<id>`). O service worker conhece a aba (sender.tab.id) e, se o id já é de OUTRA aba aberta,
 * devolve um id novo; aqui ele é gravado no sessionStorage antes de qualquer journal ou batida. Sem resposta: mantém o local.
 */
export async function registerWorkerId({ storage, send, workerId }) {
  const reg = await send({ type: 'worker.register', worker: workerId });
  const assigned = reg?.result?.worker;
  if (typeof assigned !== 'string' || !assigned || assigned === workerId) return workerId;
  try {
    storage.setItem(WORKER_KEY, assigned);
  } catch {
    /* sem sessionStorage: vale até recarregar */
  }
  return assigned;
}

export async function bootFlowWorker({ window, document, chrome }) {
  if (window.top !== window || window.__zerumFlowWorkerV1) return null; // só o quadro principal; uma vez por aba
  window.__zerumFlowWorkerV1 = true;

  let workerId = window.sessionStorage.getItem(WORKER_KEY);
  if (!workerId) {
    workerId = crypto.randomUUID();
    window.sessionStorage.setItem(WORKER_KEY, workerId);
  }

  const page = createDomPage({
    document,
    window,
    options: async () => ({ assumeSingleOutput: !!((await chrome.storage.local.get([SETTINGS_KEY]))[SETTINGS_KEY] ?? {}).assumeSingleOutput }),
  });
  const driver = createFlowDriver({ page });
  const send = async (m) => {
    try {
      return (await chrome.runtime.sendMessage(m)) ?? { error: 'SEM_RESPOSTA', code: 'SEM_RESPOSTA' };
    } catch {
      return { error: 'EXTENSAO_INDISPONIVEL', code: 'EXTENSAO_INDISPONIVEL' }; // extensão recarregada/atualizada: esta aba precisa de F5
    }
  };
  workerId = await registerWorkerId({ storage: window.sessionStorage, send, workerId });
  const worker = createFlowWorker({ driver, send, storage: chrome.storage.local, workerId, readBlob: (url) => page.mediaBytes(url), locks: window.navigator.locks ?? null });

  chrome.runtime.onMessage.addListener((m, sender, reply) => {
    if (sender.id !== chrome.runtime.id || typeof m?.type !== 'string' || !m.type.startsWith('flow.')) return false;
    worker.onMessage(m).then(reply, (e) => reply({ error: String(e?.message || e).slice(0, 160) }));
    return true;
  });

  await worker.start();
  return worker;
}
