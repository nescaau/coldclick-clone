/**
 * Adaptador de PÁGINA para o DOM real do flow.google.com (roda no content script da aba do Flow).
 *
 * Implementa a interface que drivers/flow-driver.js espera (identity, readCredits, probe, prepareComposer,
 * attachFirstFrame, typePrompt, readPrompt, clickGenerate, snapshotTiles, readTile, readErrors, mediaBytes).
 * Tudo o que depende de "onde fica o botão" vem de drivers/selectors.js; aqui só há MECÂNICA (achar visível, clicar,
 * digitar em campo controlado pelo framework, injetar arquivo, ler cartão).
 *
 * NÃO existe nenhum atalho para a API interna do Flow nem para tokens de reCAPTCHA: o clique em "gerar" é o clique
 * do próprio site, com o fluxo normal dele (incluindo a verificação anti-robô, que roda como sempre).
 */
import { ALERT_RE, CREDITS_RE, ICON_WORDS, PROJECT_PATH_RE, SELECTORS } from './selectors.js';
import { DriverError, SelectorMissing } from './flow-driver.js';
import { EMAIL_RE } from '../lib/protocol.js';
import { fromBase64, sleep as realSleep } from '../lib/util.js';

const UUID_ANY = /[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/i;
const normalize = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}.]+/gu, ' ').trim().toLowerCase();

export function createDomPage({ document, window, selectors = SELECTORS, sleep = realSleep, now = Date.now, options = async () => ({ assumeSingleOutput: false }) }) {
  let baselineErrors = new Set();
  const stable = new Map(); // tileId → {src, count} (um vídeo só é "pronto" depois de estável)

  // ─── leitura do DOM ──────────────────────────────────────────────────────────────────────────────────────────
  const isVisible = (el) => {
    if (!el?.isConnected) return false;
    const r = el.getBoundingClientRect?.();
    const cs = window.getComputedStyle?.(el);
    return !!r && r.width > 0 && r.height > 0 && cs?.visibility !== 'hidden' && cs?.display !== 'none';
  };
  const labelText = (el) => String(el.innerText ?? el.textContent ?? '').replace(ICON_WORDS, ' ').replace(/\s+/g, ' ').trim();

  /** Todos os elementos que uma estratégia acha (sem filtrar visibilidade). */
  function matches(strategy, root = document) {
    if (strategy.css) return [...root.querySelectorAll(strategy.css)];
    if (strategy.ariaLabel) {
      return [...root.querySelectorAll('[aria-label]')].filter((el) => {
        const label = el.getAttribute('aria-label') || '';
        return strategy.ariaLabel.test(label) && (!strategy.mustContain || label.includes(strategy.mustContain));
      });
    }
    if (strategy.role) {
      return [...root.querySelectorAll(`[role="${strategy.role}"]`)].filter((el) => !strategy.name || strategy.name.test(labelText(el) || el.getAttribute('aria-label') || ''));
    }
    if (strategy.icon) {
      return [...root.querySelectorAll(strategy.tag || 'button')].filter((el) => [...el.querySelectorAll('mat-icon, .material-icons, .material-symbols-outlined, .material-symbols-rounded, i, span')].some((x) => x.textContent.trim() === strategy.icon) || el.textContent.trim() === strategy.icon);
    }
    if (strategy.text) {
      const pool = [...root.querySelectorAll(strategy.tag || 'button, a, [role="button"], [role="tab"], [role="option"], [role="menuitem"], [role="radio"], li, span, div')];
      const hit = pool.filter((el) => {
        const t = labelText(el);
        return t.length > 0 && t.length < 140 && strategy.text.test(t);
      });
      // Prefere o elemento MAIS INTERNO que casa (um <div> grande com o mesmo texto não deve ganhar do botão).
      return hit.filter((el) => !hit.some((o) => o !== el && el.contains(o)));
    }
    return [];
  }

  /** Estratégias na ordem; a primeira com resultado vence. `hidden:true` aceita elemento invisível (ex.: <input type=file>). */
  function resolve(name, root = document) {
    const spec = selectors[name];
    if (!spec) throw new Error(`SELETOR_DESCONHECIDO:${name}`);
    for (const strategy of spec.strategies) {
      const found = matches(strategy, root).filter((el) => strategy.hidden || isVisible(el));
      if (found.length) return spec.pick === 'lastVisible' ? [...found].reverse() : found;
    }
    return [];
  }
  const first = (name, root) => resolve(name, root)[0] ?? null;
  const must = (name, root) => {
    const el = first(name, root);
    if (!el) throw new SelectorMissing(name);
    return el;
  };

  // ─── ações ───────────────────────────────────────────────────────────────────────────────────────────────────
  function click(el) {
    el.scrollIntoView?.({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    const init = { bubbles: true, cancelable: true, composed: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
    el.dispatchEvent(new window.PointerEvent('pointerdown', init));
    el.dispatchEvent(new window.MouseEvent('mousedown', init));
    el.dispatchEvent(new window.PointerEvent('pointerup', init));
    el.dispatchEvent(new window.MouseEvent('mouseup', init));
    el.click(); // um único "click" (disparar outro à mão ativaria o botão duas vezes)
  }

  const fire = (el, type) => el.dispatchEvent(new window.Event(type, { bubbles: true }));

  /** Escreve em <textarea>/<input> (setter nativo: o framework só percebe assim) ou em contenteditable. */
  function writeInto(el, text) {
    el.focus();
    if ('value' in el) {
      const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text);
      fire(el, 'input');
      fire(el, 'change');
      return;
    }
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
    if (!document.execCommand('insertText', false, text)) {
      el.textContent = text;
      el.dispatchEvent(new window.InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    }
  }

  async function ensureOption(name) {
    let el = first(name);
    if (el) return el;
    const open = first('settingsButton'); // a opção pode estar escondida no painel de ajustes
    if (open) {
      click(open);
      await sleep(400);
      el = first(name);
    }
    return el;
  }
  const closePanels = () => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));

  // ─── cartões da grade ────────────────────────────────────────────────────────────────────────────────────────
  const hashText = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(36);

  function tileIdOf(el, index) {
    const seen = [el, ...el.querySelectorAll('*')].slice(0, 60);
    for (const node of seen) {
      for (const attr of ['data-media-id', 'data-tile-id', 'data-id', 'href', 'src', 'id']) {
        const v = node.getAttribute?.(attr);
        const m = v && UUID_ANY.exec(v);
        if (m) return { id: m[0].toLowerCase(), weak: false };
      }
    }
    return { id: `fraco:${hashText(labelText(el).slice(0, 80))}:${index}`, weak: true };
  }

  function tileInfo(el, index) {
    const { id, weak } = tileIdOf(el, index);
    const video = el.querySelector('video');
    const src = (video && (video.currentSrc || video.getAttribute('src') || video.querySelector('source')?.getAttribute('src'))) || '';
    const text = labelText(el);
    const errorEl = matches(selectors.tileError.strategies[0], el).find(isVisible);
    const percent = /\b(\d{1,3})\s?%/.exec(text);
    const progress = percent ? Math.min(100, Number(percent[1])) : null;
    let state = 'pending';
    if (errorEl && !src) state = 'failed';
    else if (src && progress === null) {
      const s = stable.get(id);
      const count = s && s.src === src ? s.count + 1 : 1;
      stable.set(id, { src, count });
      const decoded = video.readyState >= 1 && Number.isFinite(video.duration) && video.duration > 0.5;
      if (decoded || count >= 2) state = 'ready';
    }
    return { id, weak, text: text.slice(0, 200), state, mediaUrl: state === 'ready' ? new URL(src, document.baseURI).href : '', mimeType: 'video/mp4', progress, error: state === 'failed' ? labelText(errorEl) : '' };
  }

  /** Os cartões da grade, sem repetir a mesma identidade (a estratégia pode achar o cartão e um filho dele). */
  function allTiles() {
    const seen = new Set();
    return resolve('tile')
      .map((el, i) => tileInfo(el, i))
      .filter((t) => !seen.has(t.id) && seen.add(t.id));
  }

  function currentErrors() {
    const nodes = [...document.querySelectorAll('[role="alert"], [aria-live="assertive"], [aria-live="polite"], snack-bar-container, simple-snack-bar, .mat-mdc-snack-bar-container, [class*="toast" i], [class*="snackbar" i]')].filter(isVisible);
    return nodes.map(labelText).filter((t) => t && t.length < 300 && ALERT_RE.test(t));
  }

  // ─── interface de página ─────────────────────────────────────────────────────────────────────────────────────
  return {
    async identity() {
      const label = first('accountButton')?.getAttribute('aria-label') ?? '';
      const email = (label.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/)?.[0] ?? '').toLowerCase();
      const m = PROJECT_PATH_RE.exec(window.location.pathname);
      const accountPath = /^\/u\/\d+/.exec(window.location.pathname)?.[0] ?? '';
      const signIn = !email && !!first('signInButton');
      return { email: EMAIL_RE.test(email) ? email : '', projectId: m ? m[2].toLowerCase() : '', accountPath, loggedIn: !!email && !signIn };
    },

    async readCredits() {
      const pool = [...document.querySelectorAll('button, [role="button"], [aria-label], header *, nav *, [role="menu"] *')].slice(0, 600);
      for (const el of pool) {
        const t = (el.getAttribute?.('aria-label') || labelText(el)).slice(0, 80);
        const m = CREDITS_RE.exec(t);
        if (m && isVisible(el)) {
          const n = Number(m[1].replace(/[.,]/g, ''));
          if (Number.isSafeInteger(n)) return n;
        }
      }
      return null;
    },

    async probe() {
      return Object.fromEntries(Object.keys(selectors).map((name) => [name, { found: resolve(name).length > 0, count: resolve(name).length, status: selectors[name].status }]));
    },

    async prepareComposer({ aspectRatio, model, hasFrame }) {
      baselineErrors = new Set(currentErrors());
      const opts = await options();
      const mode = await ensureOption(hasFrame ? 'modeFramesToVideo' : 'modeTextToVideo');
      if (mode) {
        click(mode);
        await sleep(300);
      }
      const aspect = await ensureOption(aspectRatio === '9:16' ? 'aspectPortrait' : 'aspectLandscape');
      if (!aspect) throw new SelectorMissing(aspectRatio === '9:16' ? 'aspectPortrait' : 'aspectLandscape');
      click(aspect);
      await sleep(300);
      if (!opts.assumeSingleOutput) {
        // Cada saída gasta crédito: sem garantia de "1 por pedido" NÃO gera (o usuário pode afirmar isso no popup).
        const one = await ensureOption('outputsOne');
        if (!one) throw new SelectorMissing('outputsOne');
        click(one);
        await sleep(300);
      }
      if (model) {
        const picker = await ensureOption('modelPicker');
        if (!picker) throw new SelectorMissing('modelPicker');
        click(picker);
        await sleep(400);
        const options2 = resolve('modelOption');
        const want = normalize(model);
        const hit = options2.find((o) => normalize(labelText(o)).includes(want));
        if (!hit) throw new DriverError('MODELO_INDISPONIVEL_NA_CONTA', 'failed', { detalhe: `"${model}" ∉ ${options2.map((o) => labelText(o)).join(' | ').slice(0, 120)}` });
        click(hit);
        await sleep(300);
      }
      closePanels();
      await sleep(200);
    },

    async attachFirstFrame(file) {
      let input = resolve('fileInput')[0] ?? null;
      if (!input) {
        const add = first('addImageButton');
        if (add) {
          click(add);
          await sleep(600);
          input = resolve('fileInput')[0] ?? null;
        }
      }
      if (!input) throw new SelectorMissing('fileInput');
      const data = new window.DataTransfer();
      data.items.add(new window.File([fromBase64(file.base64)], file.name || 'quadro', { type: file.mimeType }));
      input.files = data.files;
      fire(input, 'input');
      fire(input, 'change');
      await sleep(1500); // o site mostra a miniatura; sem sinal confiável, uma espera curta
    },

    async typePrompt(text) {
      writeInto(must('promptBox'), text);
      await sleep(200);
    },
    async readPrompt() {
      const el = must('promptBox');
      return 'value' in el ? el.value : el.innerText ?? el.textContent ?? '';
    },

    async clickGenerate() {
      const b = must('generateButton');
      if (b.disabled || b.getAttribute('aria-disabled') === 'true') throw new DriverError('BOTAO_GERAR_DESABILITADO', 'failed');
      click(b);
    },

    async snapshotTiles() {
      return allTiles();
    },
    async readTile(id) {
      return allTiles().find((t) => t.id === id) ?? null;
    },
    async readErrors() {
      return currentErrors().find((t) => !baselineErrors.has(t)) ?? '';
    },

    /** Lê bytes de blob:/mesma origem dentro da aba (https de host do Flow é baixado pelo service worker). */
    async mediaBytes(url) {
      try {
        const res = await window.fetch(url);
        if (!res.ok) return null;
        return { bytes: new Uint8Array(await res.arrayBuffer()), mimeType: res.headers.get('content-type') || 'video/mp4' };
      } catch {
        return null;
      }
    },
  };
}
