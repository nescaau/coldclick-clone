/**
 * Service worker (MV3). Só liga o núcleo (sw-core.js) ao Chrome. Os ouvintes precisam ser registrados de forma
 * síncrona, no topo do módulo — o Chrome acorda o worker para entregar o evento e reexecuta este arquivo.
 */
import { chromeKv } from '../lib/kv.js';
import { createServiceWorker } from './sw-core.js';

const version = chrome.runtime.getManifest().version;
const core = createServiceWorker({
  kv: chromeKv(chrome.storage.local),
  chrome,
  version,
  popupUrl: chrome.runtime.getURL('popup/popup.html'),
});

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  core.handleMessage(message, sender).then(reply);
  return true; // resposta assíncrona
});

const ALARM = 'zerum-tick';
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) void core.onAlarm().catch(() => {});
});
chrome.runtime.onInstalled.addListener(() => {
  void chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });
});
// O alarme sobrevive ao worker; se algum dia sumir, recria.
void chrome.alarms.get(ALARM).then((a) => a || chrome.alarms.create(ALARM, { periodInMinutes: 0.5 }));
