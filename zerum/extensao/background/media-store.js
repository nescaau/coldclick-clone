/**
 * Guarda os MP4 baixados do Flow (o "resultado" de uma ordem) no mesmo armazenamento do journal.
 *
 * Os bytes ficam em partes de até 1 MiB (base64) — `chrome.storage.local` com `unlimitedStorage` aguenta, e a ponte
 * devolve ao site UMA parte por mensagem (`download {id, part}`), sem estourar o limite de mensagem do Chrome.
 * O resultado fica guardado até o journal ser podado: se a confirmação se perder, a ENTREGA se repete, nunca a geração.
 */
import { fromBase64, sha256Hex, toBase64 } from '../lib/util.js';

/** Tamanho (em bytes brutos) de cada parte. */
export const PART_BYTES = 1024 * 1024;

const metaKey = (id) => `zr:v1:m:${id}:meta`;
const partKey = (id, n) => `zr:v1:m:${id}:${n}`;

export function createMediaStore(kv) {
  const store = {
    async meta(id) {
      return (await kv.get([metaKey(id)]))[metaKey(id)] ?? null;
    },

    /** Recomeça a gravação de `id` (apaga o que houver). */
    async begin(id, mimeType = 'video/mp4') {
      await store.delete(id);
      await kv.set({ [metaKey(id)]: { id, mimeType, parts: 0, size: 0, done: false, sha256: '' } });
    },

    /** Acrescenta uma parte (base64). Devolve o novo total em bytes. */
    async appendBase64(id, b64) {
      const meta = await store.meta(id);
      if (!meta || meta.done) throw new Error('MIDIA_NAO_INICIADA');
      const raw = fromBase64(b64);
      meta.size += raw.length;
      await kv.set({ [partKey(id, meta.parts)]: b64, [metaKey(id)]: { ...meta, parts: meta.parts + 1 } });
      return meta.size;
    },

    /** Fecha a gravação: confere o tamanho esperado (se informado) e fixa o sha256 lendo as partes. */
    async finish(id, { expectedBytes } = {}) {
      const meta = await store.meta(id);
      if (!meta) throw new Error('MIDIA_NAO_INICIADA');
      if (expectedBytes != null && meta.size !== expectedBytes) throw new Error('MIDIA_TAMANHO_DIVERGENTE');
      const chunks = [];
      for (let n = 0; n < meta.parts; n++) chunks.push(fromBase64((await kv.get([partKey(id, n)]))[partKey(id, n)] ?? ''));
      const all = new Uint8Array(meta.size);
      let at = 0;
      for (const c of chunks) {
        all.set(c, at);
        at += c.length;
      }
      if (at !== meta.size) throw new Error('MIDIA_INCOMPLETA');
      const sha256 = await sha256Hex(all);
      const done = { ...meta, done: true, sha256 };
      await kv.set({ [metaKey(id)]: done });
      return done;
    },

    /** Grava de uma vez (bytes em memória). */
    async putBytes(id, bytes, mimeType = 'video/mp4') {
      await store.begin(id, mimeType);
      const sets = {};
      let parts = 0;
      for (let at = 0; at < bytes.length; at += PART_BYTES) sets[partKey(id, parts++)] = toBase64(bytes.subarray(at, at + PART_BYTES));
      const sha256 = await sha256Hex(bytes);
      const meta = { id, mimeType, parts, size: bytes.length, done: true, sha256 };
      await kv.set({ ...sets, [metaKey(id)]: meta });
      return meta;
    },

    /** Uma parte em base64 (ou null). */
    async readPart(id, n) {
      return (await kv.get([partKey(id, n)]))[partKey(id, n)] ?? null;
    },

    async delete(id) {
      const meta = await store.meta(id);
      const keys = [metaKey(id)];
      if (meta) for (let n = 0; n < meta.parts; n++) keys.push(partKey(id, n));
      await kv.remove(keys);
    },
  };
  return store;
}
