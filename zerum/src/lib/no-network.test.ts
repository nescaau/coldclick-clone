/**
 * "Zero rede externa": varre o código-fonte do módulo (src/** e next.config.ts) com o parser do TypeScript — o AST
 * ignora comentários e enxerga strings, imports estáticos e dinâmicos, `require` e identificadores de rede.
 * (Uma regex sobre o texto já deixou passar `https://` porque o `//` da URL virava "comentário".)
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/** Módulos que abrem socket/processo ou fazem HTTP. O prefixo `node:` é ignorado na comparação. */
const NETWORK_MODULES = new Set([
  'http', 'https', 'http2', 'net', 'tls', 'dgram', 'dns', 'child_process', 'cluster',
  'axios', 'node-fetch', 'cross-fetch', 'isomorphic-fetch', 'undici', 'got', 'ky', 'superagent', 'request', 'ws', 'socket.io-client', 'eventsource',
]);
/** Globais/membros de rede. `fetch` é tratado à parte (só liberado em lib/client.ts, que fala com a própria API). */
const NETWORK_IDENTIFIERS = new Set(['WebSocket', 'EventSource', 'XMLHttpRequest', 'sendBeacon']);
/** URL absoluta cujo host não é a própria máquina. */
const EXTERNAL_URL = /\b(?:https?|wss?|ftp):\/\/(?!127\.0\.0\.1|localhost|\[::1\])/i;

const moduleName = (spec: string) => spec.replace(/^node:/, '');

/** Violações de "zero rede" de um arquivo. `allowFetch` = é o client.ts. */
export function findNetworkOffenses(fileName: string, source: string, allowFetch = false): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const at = (n: ts.Node, msg: string) => out.push(`${fileName}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}: ${msg}`);

  const checkModule = (n: ts.Node, spec: string) => {
    if (NETWORK_MODULES.has(moduleName(spec))) at(n, `import de rede ("${spec}")`);
  };

  const visit = (n: ts.Node): void => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      checkModule(n, n.moduleSpecifier.text);
    } else if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference) && ts.isStringLiteral(n.moduleReference.expression)) {
      checkModule(n, n.moduleReference.expression.text);
    } else if (ts.isCallExpression(n)) {
      const isRequire = ts.isIdentifier(n.expression) && n.expression.text === 'require';
      const isDynamicImport = n.expression.kind === ts.SyntaxKind.ImportKeyword;
      if (isRequire || isDynamicImport) {
        const arg = n.arguments[0];
        if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) checkModule(n, arg.text);
        else at(n, `${isRequire ? 'require' : 'import()'} com módulo não literal (não dá para provar que não é rede)`);
      }
    } else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) {
      if (EXTERNAL_URL.test(n.text)) at(n, `URL externa ("${n.text.slice(0, 60)}")`);
    } else if (ts.isIdentifier(n)) {
      if (NETWORK_IDENTIFIERS.has(n.text)) at(n, `uso de ${n.text}`);
      else if (n.text === 'fetch' && !allowFetch) at(n, 'fetch fora do client.ts');
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe('findNetworkOffenses (o scanner enxerga o que importa)', () => {
  const scan = (code: string) => findNetworkOffenses('x.ts', code);

  it('URL externa em string — inclusive https:// (o caso que a regex de comentários perdia)', () => {
    expect(scan(`const u = 'https://evil.example.com';`)).toHaveLength(1);
    expect(scan('const u = "http://evil.example.com/x";')).toHaveLength(1);
    expect(scan('const u = `https://evil.example.com/${id}`;')).toHaveLength(1);
    expect(scan(`const u = 'wss://evil.example.com';`)).toHaveLength(1);
    expect(findNetworkOffenses('x.tsx', `export const el = <a href="https://evil.example.com">x</a>;`)).toHaveLength(1);
  });

  it('localhost/127.0.0.1 são permitidos e comentários não contam', () => {
    expect(scan(`const u = 'http://127.0.0.1:3100/zerum'; const v = 'http://localhost:3100';`)).toEqual([]);
    expect(scan(`// veja https://evil.example.com\n/* https://evil.example.com */ const a = 1;`)).toEqual([]);
  });

  it('imports estáticos, dinâmicos e require de módulos de rede', () => {
    expect(scan(`import http from 'node:http';`)).toHaveLength(1);
    expect(scan(`import { request } from 'https';`)).toHaveLength(1);
    expect(scan(`export * from 'net';`)).toHaveLength(1);
    expect(scan(`import net = require('net');`)).toHaveLength(1);
    expect(scan(`const h = require('http');`)).toHaveLength(1);
    expect(scan(`const h = await import('node:https');`)).toHaveLength(1);
    expect(scan('const h = await import(`child_process`);')).toHaveLength(1);
    expect(scan(`const h = await import(name);`)).toHaveLength(1); // não literal: reprova por segurança
    expect(scan(`import axios from 'axios';`)).toHaveLength(1);
    expect(scan(`import fs from 'node:fs'; const p = require('node:path');`)).toEqual([]);
  });

  it('WebSocket, EventSource, XMLHttpRequest, sendBeacon e fetch', () => {
    expect(scan(`new WebSocket(url);`)).toHaveLength(1);
    expect(scan(`new EventSource(url);`)).toHaveLength(1);
    expect(scan(`new XMLHttpRequest();`)).toHaveLength(1);
    expect(scan(`navigator.sendBeacon('/x', body);`)).toHaveLength(1);
    expect(scan(`await fetch('/zerum/api/x');`)).toHaveLength(1);
    expect(scan(`await globalThis.fetch('/zerum/api/x');`)).toHaveLength(1);
    expect(findNetworkOffenses('client.ts', `await fetch('/zerum/api/x');`, true)).toEqual([]);
  });
});

describe('zero rede externa', () => {
  it('o código do módulo (src/** e next.config.ts) não importa nem chama nada de rede', () => {
    const src = path.resolve(__dirname, '..');
    const appRoot = path.resolve(src, '..');
    const files: string[] = [path.join(appRoot, 'next.config.ts')];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts')) files.push(p);
      }
    };
    walk(src);
    expect(files.length).toBeGreaterThan(30);
    expect(files.some((f) => f.endsWith('middleware.ts'))).toBe(true);
    expect(files.some((f) => f.endsWith('next.config.ts'))).toBe(true);

    const clientTs = path.join('lib', 'client.ts');
    const offenders = files.flatMap((p) => findNetworkOffenses(path.relative(appRoot, p), fs.readFileSync(p, 'utf8'), p.endsWith(clientTs)));
    expect(offenders).toEqual([]);
  });
});
