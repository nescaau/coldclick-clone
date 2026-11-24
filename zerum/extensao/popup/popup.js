/** Popup: mostra o estado real (contas, créditos, pausas, pedidos) e oferece as ações locais. Fala só com o service worker. */
const $ = (id) => document.getElementById(id);
const call = async (type, extra = {}) => {
  const r = await chrome.runtime.sendMessage({ type, ...extra });
  if (r?.error) throw new Error(r.error);
  return r?.result;
};
const el = (tag, cls, txt) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt != null) e.textContent = txt;
  return e;
};
const fmtHora = (ms) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const nf = (n) => Number(n || 0).toLocaleString('pt-BR');

const ESTADOS = { queued: 'na fila', dispatched: 'enviado à aba', accepted: 'gerando', completed: 'pronto', failed: 'falhou', unknown: 'incerto — conferindo' };
let editando = false;

function status(frase, cor, dica = '') {
  $('status').className = cor;
  $('status-frase').textContent = frase;
  $('status-dica').textContent = dica;
}

function cartaoConta(a) {
  const li = el('li');
  li.append(el('span', 'conta-email', a.context.accountId));
  const saldo = el('span', 'conta-saldo', a.credits == null ? '—' : nf(a.credits));
  saldo.append(el('small', '', 'créditos'));
  li.append(saldo);
  let estado = ['Pronta', 'ok'];
  if (a.paused) estado = ['Pausada por você', 'atencao'];
  else if (a.cooldownUntil > Date.now()) estado = [`Em pausa até ${fmtHora(a.cooldownUntil)} (cota)`, 'atencao'];
  else if (a.uncertain) estado = ['Conferindo uma geração incerta…', 'atencao'];
  else if (!a.online) estado = ['Aba do Flow fechada ou parada', 'erro'];
  li.append(el('span', `conta-estado ${estado[1]}`, estado[0]));
  li.append(el('span', 'dica', a.pending ? `${a.pending} em andamento` : ''));
  const acoes = el('div', 'conta-acoes');
  const b = el('button', 'fantasma', a.paused ? '▶ Retomar' : 'Pausar esta conta');
  b.type = 'button';
  b.addEventListener('click', () => acionar('popup.pause', { email: a.context.accountId, paused: !a.paused }));
  acoes.append(b);
  li.append(acoes);
  return li;
}

async function refresh() {
  try {
    const s = await call('popup.status');
    $('versao').textContent = `Flow · extensão local v${s.version}`;
    const h = s.health;
    const online = s.accounts.filter((a) => a.online);
    if (h.state === 'healthy') status(`Flow ligado · ${online.length} conta${online.length === 1 ? '' : 's'}`, 'verde', 'Pode voltar ao Zerum e gerar.');
    else if (h.state === 'not-ready') status('Flow aberto, mas ainda não está pronto', 'amarelo', h.detail);
    else status('Flow fechado', 'vermelho', h.detail);

    const ul = $('contas');
    ul.replaceChildren(...(s.accounts.length ? s.accounts.map(cartaoConta) : [Object.assign(el('li', 'vazio', 'Nenhuma conta ainda. Abra o Flow, entre na sua conta e abra um projeto.'))]));

    if (!editando) {
      $('origens').value = s.origins.join('\n');
      $('um-resultado').checked = !!s.assumeSingleOutput;
    }
    $('recentes-n').textContent = s.journal.orders.length ? String(s.journal.orders.length) : '';
    $('recentes').replaceChildren(...s.journal.orders.map((o) => el('li', '', `${o.cmd} · ${ESTADOS[o.state] ?? o.state}${o.error ? ` · ${o.error}` : ''} · ${fmtHora(o.updated)}`)));
  } catch (e) {
    status('Não consegui falar com a extensão', 'vermelho', String(e.message || e));
  }
}

async function acionar(tipo, extra) {
  try {
    await call(tipo, extra);
  } catch (e) {
    status('Não deu certo agora', 'vermelho', String(e.message || e));
  }
  await refresh();
}

$('abrir-flow').addEventListener('click', () => acionar('popup.open-flow'));
$('limpar').addEventListener('click', () => acionar('popup.prune'));
$('um-resultado').addEventListener('change', () => acionar('popup.settings', { assumeSingleOutput: $('um-resultado').checked }));
$('origens').addEventListener('focus', () => (editando = true));
$('salvar-origens').addEventListener('click', async () => {
  try {
    const r = await call('popup.origins', { origins: $('origens').value.split(/\s+/).filter(Boolean) });
    $('origens').value = r.origins.join('\n');
    $('origens-msg').textContent = 'Salvo. Recarregue a página do Zerum.';
  } catch {
    $('origens-msg').textContent = 'Use endereços locais, como http://127.0.0.1:3100 (um por linha).';
  }
  editando = false;
});
$('diagnostico').addEventListener('click', async () => {
  const ul = $('diag');
  ul.replaceChildren(el('li', '', 'Conferindo…'));
  try {
    const r = await call('popup.probe');
    const itens = Object.entries(r.elements).map(([nome, v]) => el('li', v.found ? 'achou' : 'falta', `${v.found ? '✓' : '✗'} ${nome} (${v.found ? `${v.count}` : 'não achei'}) · ${v.status}`));
    ul.replaceChildren(el('li', '', `conta: ${r.identity.email || '—'} · projeto: ${r.identity.projectId ? 'aberto' : 'não aberto'}`), ...itens);
  } catch (e) {
    ul.replaceChildren(el('li', 'falta', `✗ ${String(e.message || e)}`));
  }
});

void refresh();
setInterval(refresh, 3000);
