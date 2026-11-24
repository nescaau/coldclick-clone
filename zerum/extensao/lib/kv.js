/**
 * Armazenamento chave→valor usado pelo journal. Duas implementações com a MESMA interface:
 *  - `chromeKv(area)`: `chrome.storage.local` (o journal de verdade; o manifesto pede `unlimitedStorage`);
 *  - `memoryKv()`: em memória, para os testes — copia por JSON, como o Chrome, para não haver aliasing.
 *
 * Interface: `get(keys[]) → {chave: valor}` (só as chaves que existem), `set({chave: valor})` (atômico),
 * `remove(keys[])`, `keys(prefix) → string[]`.
 */

export function memoryKv(initial = {}) {
  const store = new Map(Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)]));
  const kv = {
    async get(keys) {
      const out = {};
      for (const k of keys) if (store.has(k)) out[k] = JSON.parse(store.get(k));
      return out;
    },
    async set(obj) {
      // Valida tudo antes de gravar: ou entra o conjunto inteiro, ou nada (como o storage.local do Chrome).
      const next = Object.entries(obj).map(([k, v]) => [k, JSON.stringify(v)]);
      if (kv.failNextSet) {
        kv.failNextSet = false;
        throw new Error('STORAGE_FALHOU');
      }
      for (const [k, v] of next) store.set(k, v);
    },
    async remove(keys) {
      for (const k of keys) store.delete(k);
    },
    async keys(prefix = '') {
      return [...store.keys()].filter((k) => k.startsWith(prefix));
    },
    /** Só para testes. */
    failNextSet: false,
    dump: () => Object.fromEntries([...store.entries()].map(([k, v]) => [k, JSON.parse(v)])),
    bytes: () => [...store.values()].reduce((n, v) => n + v.length, 0),
  };
  return kv;
}

export function chromeKv(area) {
  return {
    async get(keys) {
      return keys.length ? await area.get(keys) : {};
    },
    async set(obj) {
      await area.set(obj);
    },
    async remove(keys) {
      if (keys.length) await area.remove(keys);
    },
    async keys(prefix = '') {
      // getKeys existe no Chrome ≥ 130; antes disso lê tudo (o journal só guarda o que é nosso).
      const all = area.getKeys ? await area.getKeys() : Object.keys(await area.get(null));
      return all.filter((k) => k.startsWith(prefix));
    },
  };
}
