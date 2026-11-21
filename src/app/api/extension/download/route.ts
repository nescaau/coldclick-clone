import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { zipSync } from 'fflate';
import { AppError } from '@/lib/errors';
import { api } from '@/lib/http';

const EXTENSION_DIR = path.join(process.cwd(), 'extension');

/** Lê recursivamente a pasta da extensão para um mapa { caminho-relativo: bytes }. */
function collectFiles(dir: string, base = ''): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(files, collectFiles(path.join(dir, entry.name), rel));
    else if (entry.isFile()) files[rel] = readFileSync(path.join(dir, entry.name));
  }
  return files;
}

/** Baixa a extensão (pasta /extension) como ZIP pronto para "Carregar sem compactação". */
export const GET = api(async () => {
  let files: Record<string, Uint8Array>;
  let version = '0.0.0';
  try {
    files = collectFiles(EXTENSION_DIR);
    version = (JSON.parse(readFileSync(path.join(EXTENSION_DIR, 'manifest.json'), 'utf8')) as { version: string }).version;
  } catch {
    throw new AppError(404, 'Pasta da extensão não encontrada');
  }
  const zip = zipSync(files, { level: 6 });
  return new Response(Buffer.from(zip), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="coldclick-flow-connector-${version}.zip"`,
      'Cache-Control': 'no-store',
    },
  });
});
