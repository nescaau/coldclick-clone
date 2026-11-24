// Content script clássico (o Chrome não aceita módulo direto aqui): carrega o relay como módulo da própria extensão.
(async () => {
  try {
    const { startSiteRelay } = await import(chrome.runtime.getURL('content/site-relay.js'));
    startSiteRelay({ window, chrome });
  } catch (e) {
    console.warn('[zerum-ext] relay não iniciou', e);
  }
})();
