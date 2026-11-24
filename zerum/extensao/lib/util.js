/** Utilitários puros (rodam no service worker, nas abas e no Node dos testes). Sem rede. */

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Erro com código estável (o `code` é o que o site e os testes comparam; `message` repete o código). */
export class ZerumError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'ZerumError';
    this.code = code;
    Object.assign(this, details);
  }
}

/** Corrida contra o relógio: rejeita com `code` se `p` não terminar em `ms`. `state` diz o que o broker deve concluir. */
export function deadline(p, ms, code, state = 'unknown', timers = { setTimeout, clearTimeout }) {
  return new Promise((resolve, reject) => {
    const timer = timers.setTimeout(() => reject(new ZerumError(code, { state })), ms);
    Promise.resolve(p).then(
      (v) => {
        timers.clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        timers.clearTimeout(timer);
        reject(e);
      },
    );
  });
}

const B64_STEP = 0x8000;

/** Uint8Array → base64 (em fatias: `String.fromCharCode(...bytes)` estoura a pilha em arquivos grandes). */
export function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += B64_STEP) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + B64_STEP));
  return btoa(bin);
}

export function fromBase64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** JSON com chaves ordenadas: a mesma estrutura gera sempre o mesmo texto (base de chaves/impressões digitais estáveis). */
export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : stableStringify(v))).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined && typeof value[k] !== 'function').sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

const encoder = new TextEncoder();
export const fingerprint = (value) => sha256Hex(encoder.encode(stableStringify(value)));

/** Cópia profunda tolerante (o que cruza o storage do Chrome é JSON: o teste usa o mesmo caminho). */
export const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** Serializa tarefas assíncronas: cada uma só começa quando a anterior termina (mesmo se a anterior falhar). */
export function createMutex() {
  let tail = Promise.resolve();
  return (fn) => {
    const run = tail.then(fn, fn);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

/** Texto curto e seguro para mensagens de erro (nunca devolve dados do usuário inteiros). */
export const shortText = (v, max = 160) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
