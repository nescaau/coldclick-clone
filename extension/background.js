// Service worker (Manifest V3) da extensão ColdClick Conector.
//
// FASE 1 (este arquivo): pareamento com o estúdio e sinal de vida (heartbeat).
// FASE 2: receber tarefas de geração no heartbeat, repassá-las ao content script
//         da aba do Flow e devolver os arquivos gerados ao estúdio (ver content.js).
//
// Observação MV3: o service worker é encerrado quando fica ocioso, por isso NÃO se guarda
// estado em variáveis — tudo vai para chrome.storage.local, e o heartbeat usa chrome.alarms.

const DEFAULT_SERVER = 'http://localhost:3000';
const HEARTBEAT_ALARM = 'coldclick-heartbeat';
const HEARTBEAT_PERIOD_MIN = 0.5; // 30 s (extensões "sem compactação" não têm o limite mínimo de alarmes)
const FLOW_TAB_PATTERNS = ['https://flow.google.com/*', 'https://labs.google/fx/*'];

async function getConfig() {
  const { server = DEFAULT_SERVER, token = null, deviceName = null } = await chrome.storage.local.get(['server', 'token', 'deviceName']);
  return { server: server.replace(/\/+$/, ''), token, deviceName };
}

/** Troca o código exibido na página "Contas Flow" por um token e passa a enviar heartbeats. */
async function pair({ server, code, deviceName }) {
  const base = (server || DEFAULT_SERVER).replace(/\/+$/, '');
  const res = await fetch(`${base}/api/extension/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, deviceName: deviceName || 'Chrome', version: chrome.runtime.getManifest().version }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);

  await chrome.storage.local.set({ server: base, token: data.token, deviceName: deviceName || 'Chrome', lastHeartbeat: null, lastError: null });
  await chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: HEARTBEAT_PERIOD_MIN });
  await heartbeat();
}

async function unpair() {
  await chrome.alarms.clear(HEARTBEAT_ALARM);
  await chrome.storage.local.remove(['token', 'lastHeartbeat', 'lastError']);
}

async function heartbeat() {
  const { server, token } = await getConfig();
  if (!token) return;
  try {
    // Há uma aba do Flow aberta? (a conta logada será reportada pelo content script na fase 2)
    const flowTabs = await chrome.tabs.query({ url: FLOW_TAB_PATTERNS });
    const res = await fetch(`${server}/api/extension/heartbeat`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: chrome.runtime.getManifest().version, flowSessionActive: flowTabs.length > 0 }),
    });
    if (res.status === 401) {
      // Pareamento revogado no estúdio: limpa o token local.
      await unpair();
      await chrome.storage.local.set({ lastError: 'Pareamento revogado no estúdio.' });
      return;
    }
    if (!res.ok) throw new Error(`Erro ${res.status}`);
    const data = await res.json();
    await chrome.storage.local.set({ lastHeartbeat: data.serverTime, lastError: null });
    // FASE 2: `data.tasks` trará as gerações a executar → chrome.tabs.sendMessage(tabDoFlow, { type: 'RUN_TASK', task }).
  } catch (e) {
    await chrome.storage.local.set({ lastError: `Sem conexão com o estúdio (${e.message}).` });
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === HEARTBEAT_ALARM) void heartbeat();
});

// Garante o alarme após atualizações/reinícios do navegador.
chrome.runtime.onStartup.addListener(async () => {
  const { token } = await getConfig();
  if (token) await chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: HEARTBEAT_PERIOD_MIN });
});

// Mensagens do popup.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const run = async () => {
    if (msg.type === 'PAIR') await pair(msg);
    if (msg.type === 'UNPAIR') await unpair();
    return { ok: true };
  };
  run().then(sendResponse, (e) => sendResponse({ ok: false, error: e.message }));
  return true; // resposta assíncrona
});
