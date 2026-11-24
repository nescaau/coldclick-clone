/**
 * Relay do SITE (content script na página do Zerum local): ponte entre `window.postMessage` e o service worker.
 *
 *   site → extensão   { zre:'request',  id, action, payload }
 *   extensão → site   { zre:'response', id, result } | { zre:'response', id, error, code?, retryable?, retryAt? }
 *   extensão → site   { zre:'flow-health', health }      (saúde sanitizada; nunca journal, mídia ou token)
 *
 * Regras do original, mantidas: só `e.source === window` e `e.origin === location.origin`; `id` string de 1..128;
 * ação fora da lista é ignorada em silêncio. A autorização da ORIGEM é do service worker (lista no popup).
 * Além disso o relay deixa na página dois marcadores para o app detectar a extensão sem esperar resposta:
 *   <html data-zerum-extension="0.1.0">  e  data-zerum-extension-origin="allowed|blocked".
 */
import { onSitePath } from '../background/policy.js';
import { BRIDGE_ACTIONS, STATUS_KEY, isValidMessageId } from '../lib/protocol.js';

/** Converte a resposta do service worker na mensagem `zre:'response'` (campos extras só os que o site conhece). */
export function toResponse(id, action, r) {
  if (!r) return { zre: 'response', id, error: 'SEM_RESPOSTA', code: 'SEM_RESPOSTA', action };
  if (r.error) {
    return {
      zre: 'response',
      id,
      error: String(r.error).slice(0, 200),
      code: r.code ?? String(r.error).slice(0, 80),
      retryable: r.retryable === true,
      ...(Number.isFinite(r.retryAt) ? { retryAt: r.retryAt } : {}),
      action,
    };
  }
  return { zre: 'response', id, result: r.result === undefined ? null : r.result };
}

export function startSiteRelay({ window, chrome, document = window.document, location = window.location }) {
  if (window.__zerumSiteRelayV1) return false;
  if (!onSitePath(location.pathname)) return false; // não é o Zerum: não toca em nada
  window.__zerumSiteRelayV1 = true;

  document.documentElement.setAttribute('data-zerum-extension', chrome.runtime.getManifest().version);
  const post = (message) => window.postMessage(message, location.origin);
  const pushHealth = (health) => post({ zre: 'flow-health', health: health ?? null });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[STATUS_KEY]) pushHealth(changes[STATUS_KEY].newValue?.health);
  });
  chrome.storage.local.get(STATUS_KEY).then((s) => pushHealth(s?.[STATUS_KEY]?.health), () => {});
  chrome.runtime
    .sendMessage({ type: 'site.hello' })
    .then((r) => document.documentElement.setAttribute('data-zerum-extension-origin', r?.result?.allowed ? 'allowed' : 'blocked'))
    .catch(() => {});

  window.addEventListener('message', async (e) => {
    if (e.source !== window || e.origin !== location.origin || e.data?.zre !== 'request') return;
    const { id, action, payload } = e.data;
    if (!isValidMessageId(id) || !BRIDGE_ACTIONS.includes(action)) return;
    try {
      post(toResponse(id, action, await chrome.runtime.sendMessage({ type: 'rpc', action, payload })));
    } catch (err) {
      post({ zre: 'response', id, error: String(err?.message || 'EXTENSAO_INDISPONIVEL').slice(0, 200), code: 'EXTENSAO_INDISPONIVEL', action });
    }
  });
  return true;
}
