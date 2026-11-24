/**
 * "Sem telemetria, sem rede além do necessário" — também para a EXTENSÃO (que o teste de rede do app, que varre src/**,
 * não enxerga). Varre o código da extensão com o parser do TypeScript (como o teste do app) e reprova:
 *  - XMLHttpRequest, WebSocket, EventSource, sendBeacon, importScripts, eval/new Function;
 *  - `fetch` fora dos dois lugares que o usam de propósito (download do MP4 do Flow e leitura de blob: da própria aba);
 *  - qualquer URL absoluta que não seja o flow.google.com ou a própria máquina;
 *  - APIs do Chrome além de storage/runtime/alarms/tabs; import dinâmico que não seja o carregamento dos módulos da extensão;
 *  - recursos externos no popup (fontes, scripts, imagens) e script inline.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['test', 'tools']);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!(dir === root && SKIP.has(e.name))) walk(p, out);
    } else out.push(p);
  }
  return out;
}
const files = walk(root);
const js = files.filter((f) => f.endsWith('.js'));
const rel = (f) => path.relative(root, f).split(path.sep).join('/');

const BANNED = new Set(['XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon', 'importScripts', 'eval']);
/** `fetch` existe em exatamente dois arquivos: o SW (baixar o MP4 do host do Flow) e a aba (ler blob:/mesma origem). */
const FETCH_OK = new Set(['background/sw-core.js', 'drivers/dom-page.js']);
const CHROME_OK = new Set(['storage', 'runtime', 'alarms', 'tabs']);
const URL_RE = /\b(?:https?|wss?|ftp):\/\/([^/\s"'`:?#)]+)/gi;
/** O flow.google.com, o host que serve os MP4 do Flow (manifest host_permissions) e a própria máquina. */
const HOST_OK = (h) => h === 'flow.google.com' || h === 'flow-content.google' || h === '127.0.0.1' || h === 'localhost';

/** Algum identificador `fetch` de verdade (não o texto "fetch" dentro de uma string ou comentário)? */
function usesFetch(source) {
  const sf = ts.createSourceFile('x.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let found = false;
  const visit = (n) => {
    if (ts.isIdentifier(n) && n.text === 'fetch') found = true;
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

export function audit(file, source) {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const out = [];
  const at = (n, msg) => out.push(`${file}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}: ${msg}`);
  const chromeApis = new Set();
  const visit = (n) => {
    if (ts.isIdentifier(n)) {
      if (BANNED.has(n.text)) at(n, `uso de ${n.text}`);
      if (n.text === 'fetch' && !FETCH_OK.has(file)) at(n, 'fetch fora dos dois arquivos permitidos');
    }
    if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'Function') at(n, 'new Function');
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = n.arguments[0];
      const ok = arg && ts.isCallExpression(arg) && arg.expression.getText(sf) === 'chrome.runtime.getURL' && /(site-relay-loader|flow-loader)\.js$/.test(file);
      if (!ok) at(n, 'import() dinâmico fora dos carregadores de content script');
    }
    if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'chrome') chromeApis.add(n.name.text);
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) {
      for (const m of n.text.matchAll(URL_RE)) if (!HOST_OK(m[1].toLowerCase())) at(n, `URL externa (${m[0]})`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  for (const api of chromeApis) if (!CHROME_OK.has(api)) out.push(`${file}: chrome.${api} não é permitido`);
  return out;
}

describe('o scanner enxerga o que importa (provas negativas)', () => {
  const scan = (code, file = 'x.js') => audit(file, code);
  it('rede e execução dinâmica', () => {
    expect(scan('new XMLHttpRequest()')).toHaveLength(1);
    expect(scan('new WebSocket(u)')).toHaveLength(1);
    expect(scan('navigator.sendBeacon(u, d)')).toHaveLength(1);
    expect(scan('eval("x")')).toHaveLength(1);
    expect(scan('new Function("x")')).toHaveLength(1);
    expect(scan('await fetch(u)')).toHaveLength(1);
    expect(scan('await fetch(u)', 'background/sw-core.js')).toEqual([]);
    expect(scan('import(name)')).toHaveLength(1);
    expect(scan('import(chrome.runtime.getURL("x.js"))', 'content/flow-loader.js')).toEqual([]);
  });
  it('URLs e APIs do Chrome', () => {
    expect(scan("const u = 'https://evil.example.com/x';")).toHaveLength(1);
    expect(scan("const u = `https://api.example.com/${id}`;")).toHaveLength(1);
    expect(scan("const u = 'https://flow.google.com/project/x'; const v = 'http://127.0.0.1:3100'; const w = 'http://localhost/zerum';")).toEqual([]);
    expect(scan('// https://evil.example.com\nconst a = 1;')).toEqual([]); // comentário não conta
    expect(scan('chrome.downloads.download({})')).toHaveLength(1);
    expect(scan('chrome.cookies.getAll({})')).toHaveLength(1);
    expect(scan('chrome.storage.local.get([])')).toEqual([]);
  });
});

describe('a extensão não fala com ninguém além do necessário', () => {
  it('há código para varrer', () => {
    expect(js.length).toBeGreaterThan(12);
    expect(js.map(rel)).toEqual(expect.arrayContaining(['background/broker.js', 'background/sw-core.js', 'content/flow-worker.js', 'drivers/dom-page.js', 'content/site-relay.js']));
  });

  it('nenhum arquivo .js usa rede/execução dinâmica/API do Chrome fora do permitido, nem tem URL externa', () => {
    const offenders = js.flatMap((f) => audit(rel(f), fs.readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('`fetch` realmente aparece só nos dois arquivos autorizados (e eles estão lá)', () => {
    const using = js.filter((f) => usesFetch(fs.readFileSync(f, 'utf8'))).map(rel).sort();
    expect(using).toEqual([...FETCH_OK].sort());
  });

  it('popup.html: sem recurso externo, sem script inline, só arquivos da extensão', () => {
    const html = fs.readFileSync(path.join(root, 'popup', 'popup.html'), 'utf8');
    expect(html).not.toMatch(/https?:\/\//i);
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
    expect(html).not.toMatch(/\son\w+\s*=/i); // sem handlers inline (CSP do MV3)
    for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) expect(fs.existsSync(path.join(root, 'popup', m[1])), m[1]).toBe(true);
    const css = fs.readFileSync(path.join(root, 'popup', 'popup.css'), 'utf8');
    expect(css).not.toMatch(/url\(|@import|https?:\/\//i);
  });

  it('manifesto: sem permissões amplas', () => {
    const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    expect(m.permissions).not.toEqual(expect.arrayContaining(['downloads', 'cookies', 'webRequest', 'scripting', 'history', 'tabs', 'identity']));
    expect(m.optional_permissions ?? []).toEqual([]);
    expect(m.content_security_policy).toBeUndefined(); // o padrão do MV3 (script-src 'self') já é o mais restrito
  });
});
