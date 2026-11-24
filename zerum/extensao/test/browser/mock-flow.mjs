/**
 * "Flow de mentira" para o navegador de verdade: um servidor HTTPS local que imita, o suficiente, a página do Google Flow
 * (conta no topo, créditos, caixa de prompt, painel de ajustes escondido, botão Create, grade de clipes que "geram" e
 * viram <video>) e serve os MP4 no lugar do CDN do Flow. É o alvo do teste e2e-browser: o navegador mapeia
 * flow.google.com e flow-content.google para este servidor (--host-resolver-rules) e aceita o certificado de teste.
 *
 * NÃO é o Flow: serve para provar a MECÂNICA da extensão (injeção, digitar, anexar imagem, clicar, ler o cartão, baixar
 * o MP4 pelo service worker). Os seletores reais do Flow continuam precisando ser conferidos numa conta real.
 *
 * Cada pedido enviado fica em `window.__mock.submissions` (o teste lê pelo navegador) e em `server.submissions`.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';

export const MOCK_PROJECT_ID = '33333333-3333-4333-8333-333333333333';

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Flow (mock)</title>
<style>
  body{font:14px system-ui;margin:0;background:#111;color:#eee}
  header{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid #333}
  main{padding:16px;min-height:300px}
  #grid{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}
  #grid li{border:1px solid #333;border-radius:8px;padding:8px;min-height:120px}
  #grid video{width:100%;height:110px;background:#000}
  footer{position:fixed;left:0;right:0;bottom:0;background:#1b1b1b;border-top:1px solid #333;padding:10px 16px}
  #panel{padding:8px 0}
  button,textarea{font:inherit}
  #toast{position:fixed;right:16px;top:60px}
</style></head>
<body>
<header>
  <span>Flow · mock</span>
  <span><span id="credits">1,250 AI credits</span>
  <button type="button" aria-label="Google Account: Ana Teste (ana@gmail.com)">A</button></span>
</header>
<main><ul id="grid"></ul></main>
<div id="toast"></div>
<footer>
  <div id="panel" hidden>
    <button type="button" role="tab" data-mode="t2v">Text to Video</button>
    <button type="button" role="tab" data-mode="f2v">Frames to Video</button>
    <button type="button" data-aspect="16:9">16:9</button>
    <button type="button" data-aspect="9:16">9:16</button>
    <button type="button" data-out="1">x1</button>
    <button type="button" data-out="2">x2</button>
    <button type="button" data-out="4">x4</button>
  </div>
  <input type="file" accept="image/*" hidden id="file">
  <button type="button" aria-label="Settings" id="settings">tune</button>
  <textarea id="prompt" placeholder="What do you want to create?" rows="2" cols="60"></textarea>
  <button type="button" id="create"><span class="material-icons">arrow_forward</span>Create</button>
</footer>
<script>
  const S = { mode: 't2v', aspect: '16:9', out: 4 };
  window.__mock = { submissions: [], toasts: [] };
  const $ = (s) => document.querySelector(s);
  $('#settings').addEventListener('click', () => { $('#panel').hidden = !$('#panel').hidden; });
  $('#panel').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.mode) S.mode = b.dataset.mode;
    if (b.dataset.aspect) S.aspect = b.dataset.aspect;
    if (b.dataset.out) S.out = Number(b.dataset.out);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#panel').hidden = true; });
  const uuid = () => crypto.randomUUID();
  function toast(text) { const t = document.createElement('div'); t.setAttribute('role', 'alert'); t.textContent = text; $('#toast').appendChild(t); window.__mock.toasts.push(text); setTimeout(() => t.remove(), 30000); }
  $('#create').addEventListener('click', () => {
    const prompt = $('#prompt').value.trim();
    if (!prompt) return;
    const file = $('#file').files[0];
    window.__mock.submissions.push({ prompt, aspect: S.aspect, outputs: S.out, mode: S.mode, file: file ? { name: file.name, size: file.size, type: file.type } : null });
    if (/QUOTA-TEST/.test(prompt)) { toast("You've reached your daily quota for video generation (429)"); return; }
    if (S.out !== 1) { toast('Error: too many outputs selected'); return; }
    const id = uuid();
    const li = document.createElement('li');
    li.dataset.mediaId = id;
    li.innerHTML = '<div class="spin">0%</div><p></p>';
    li.querySelector('p').textContent = prompt;
    $('#grid').prepend(li);
    let pct = 0;
    const iv = setInterval(() => {
      pct += 20;
      if (pct < 100) { li.querySelector('.spin').textContent = pct + '%'; return; }
      clearInterval(iv);
      li.querySelector('.spin').outerHTML = '<video src="https://flow-content.google/video/' + id + '" muted playsinline preload="auto"></video>';
    }, 450);
  });
</script>
</body></html>`;

/** @returns {Promise<{port:number, close():Promise<void>, hits:string[]}>} */
export async function startMockFlow({ port = 8443, clip }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zerum-mockflow-'));
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '2', '-subj', '/CN=flow.google.com', '-addext', 'subjectAltName=DNS:flow.google.com,DNS:flow-content.google'], { stdio: 'ignore' });
  const hits = [];
  const server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (req, res) => {
    hits.push(`${req.headers.host}${req.url}`);
    const url = new URL(req.url, 'https://x');
    if (url.pathname.startsWith('/video/')) {
      const bytes = typeof clip === 'function' ? clip() : clip;
      res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': bytes.length, 'accept-ranges': 'bytes', 'access-control-allow-origin': '*' });
      res.end(Buffer.from(bytes));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  });
  await new Promise((resolve, reject) => server.once('error', reject).listen(port, '127.0.0.1', resolve));
  return {
    port,
    hits,
    close: () => new Promise((resolve) => server.close(() => resolve(fs.rmSync(dir, { recursive: true, force: true })))),
  };
}
