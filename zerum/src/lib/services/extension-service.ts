/**
 * A extensão do Chrome (pasta zerum/extensao) empacotada pelo próprio app: o botão "Baixar a extensão" entrega um .zip
 * (sem sair do app, sem rede). O zip leva só o necessário para rodar — sem testes nem ferramentas de desenvolvimento.
 */
import fs from 'node:fs';
import path from 'node:path';
import { EXTENSION_DIR } from '../config';
import { AppError } from '../errors';
import type { ZipEntry } from '../domain/zip';

/** Pasta (dentro do zip) em que a extensão é extraída. */
export const ZIP_FOLDER = 'zerum-extensao';

/** Fora do pacote: testes, ferramentas, pontos e node_modules. */
const SKIP_DIRS = new Set(['test', 'tools', 'node_modules']);

const INSTALAR = (version: string) => `Extensão Zerum · Flow (local) — versão ${version} — como instalar

1. Extraia este ZIP para uma pasta PERMANENTE no seu computador (não apague a pasta "${ZIP_FOLDER}" depois).
2. No Chrome, abra chrome://extensions e ligue o "Modo do desenvolvedor" (canto de cima, à direita).
3. Clique em "Carregar sem compactação" e escolha a pasta "${ZIP_FOLDER}" extraída.
4. Abra o Flow (ícone da extensão → "Abrir o Flow"), entre na SUA conta Google e abra (ou crie) um projeto.
5. Volte ao Zerum, recarregue a página e clique em "Conectar o Flow". Depois desligue a "Simulação local" em ⚙ para gerar de verdade.

A extensão só conversa com a página do Zerum neste computador (http://127.0.0.1:3100) e com o flow.google.com.
Sem login, sem servidor da 001, sem telemetria. Se usar outra porta, adicione o endereço em "Sites autorizados" no ícone da extensão.
`;

function walk(dir: string, rel: string, out: string[]): void {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    if (e.isDirectory()) {
      if (rel === '' && SKIP_DIRS.has(e.name)) continue;
      walk(path.join(dir, e.name), `${rel}${e.name}/`, out);
    } else if (e.isFile() && !/\.test\.[mc]?[jt]s$/.test(e.name)) out.push(`${rel}${e.name}`);
  }
}

export function extensionManifest(): { version: string; name: string } | null {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(EXTENSION_DIR, 'manifest.json'), 'utf8')) as { version?: string; name?: string };
    return m.version ? { version: m.version, name: m.name ?? 'Zerum · Flow (local)' } : null;
  } catch {
    return null;
  }
}

/** Entradas do zip da extensão. 404 claro se a pasta não está junto do app (ex.: build copiado sem ela). */
export function extensionZipEntries(): { name: string; entries: ZipEntry[] } {
  const manifest = extensionManifest();
  if (!manifest) throw new AppError(404, 'A pasta da extensão (zerum/extensao) não está neste computador junto do app. Use a pasta do repositório em chrome://extensions → Carregar sem compactação.');
  const files: string[] = [];
  walk(EXTENSION_DIR, '', files);
  files.sort();
  const entries: ZipEntry[] = files.map((rel) => {
    const abs = path.resolve(EXTENSION_DIR, rel);
    if (!abs.startsWith(EXTENSION_DIR + path.sep)) throw new AppError(500, 'Caminho inválido na pasta da extensão.');
    return { name: `${ZIP_FOLDER}/${rel}`, data: () => fs.createReadStream(abs) };
  });
  entries.push({ name: `${ZIP_FOLDER}/INSTALAR.txt`, data: new TextEncoder().encode(INSTALAR(manifest.version)) });
  return { name: `zerum-extensao-${manifest.version}.zip`, entries };
}
