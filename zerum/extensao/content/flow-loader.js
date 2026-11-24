// Content script clássico: carrega o worker da aba do Flow como módulo da própria extensão.
(async () => {
  try {
    const { bootFlowWorker } = await import(chrome.runtime.getURL('content/flow-main.js'));
    await bootFlowWorker({ window, document, chrome });
  } catch (e) {
    console.warn('[zerum-ext] worker do Flow não iniciou', e);
  }
})();
