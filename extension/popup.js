// Popup da extensão: pareamento com o estúdio e exibição do estado.
const $ = (id) => document.getElementById(id);

function setStatus(text, kind = '') {
  const el = $('status');
  el.textContent = text;
  el.className = kind;
}

async function render() {
  const { token, server, lastHeartbeat, lastError } = await chrome.storage.local.get(['token', 'server', 'lastHeartbeat', 'lastError']);
  $('unpaired').hidden = Boolean(token);
  $('paired').hidden = !token;
  if (token) {
    $('paired-server').textContent = server;
    if (lastError) setStatus(lastError, 'error');
    else if (lastHeartbeat) setStatus(`Último sinal: ${new Date(lastHeartbeat).toLocaleTimeString('pt-BR')}`, 'ok');
    else setStatus('Conectando…');
  }
}

$('pair').addEventListener('click', async () => {
  setStatus('Pareando…');
  const res = await chrome.runtime.sendMessage({
    type: 'PAIR',
    server: $('server').value.trim(),
    code: $('code').value.trim(),
    deviceName: 'Chrome',
  });
  if (res?.ok) {
    setStatus('Pareado com sucesso!', 'ok');
    await render();
  } else {
    setStatus(res?.error || 'Falha ao parear', 'error');
  }
});

$('unpair').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'UNPAIR' });
  setStatus('');
  await render();
});

void render();
