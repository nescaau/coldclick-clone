import fs from 'node:fs';
import path from 'node:path';
import type { Metadata } from 'next';
import { BASE_PATH } from '@/lib/config.shared';
import { EXTENSION_DIR } from '@/lib/config';

export const metadata: Metadata = { title: 'Extensão do Zerum · ZERUM 001' };
export const dynamic = 'force-dynamic';

const versao = (): string | null => {
  try {
    return (JSON.parse(fs.readFileSync(path.join(EXTENSION_DIR, 'manifest.json'), 'utf8')) as { version?: string }).version ?? null;
  } catch {
    return null;
  }
};

const card = 'rounded-3xl border border-white/10 bg-white/5 p-6';
const botao = 'inline-block rounded-xl bg-white px-5 py-2.5 text-sm font-black text-black hover:bg-zinc-100';

/** Passo a passo da extensão do Zerum (dentro do app: nada aqui sai para a internet). */
export default function Page() {
  const v = versao();
  return (
    <main className="mx-auto max-w-3xl space-y-5 px-5 py-10 text-white">
      <p>
        <a href={BASE_PATH} className="text-sm text-zinc-400 underline hover:text-white">
          ← Voltar ao Zerum
        </a>
      </p>
      <h1 className="text-3xl font-black uppercase tracking-tight">Extensão Zerum · Flow{v ? ` (v${v})` : ''}</h1>
      <p className="text-sm text-zinc-300">
        A extensão do Chrome é quem opera o Google Flow na <b>sua</b> conta: abre o projeto, escreve o pedido de cada cena, espera o clipe ficar pronto, baixa o MP4 e entrega ao Zerum. Ela só conversa com esta página (neste computador) e com o flow.google.com — sem login da 001, sem servidor, sem telemetria.
      </p>

      <section className={card}>
        <h2 className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-zinc-400">Instalar</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-zinc-200">
          <li>
            Baixe a extensão: <a href={`${BASE_PATH}/api/extension/package`} className={botao}>⬇ Baixar a extensão (.zip)</a> e extraia numa pasta <b>permanente</b> (não apague depois). Quem roda o app a partir do repositório também pode usar direto a pasta <code className="rounded bg-black/40 px-1">zerum/extensao</code>.
          </li>
          <li>
            No Chrome, abra <code className="rounded bg-black/40 px-1">chrome://extensions</code> e ligue o <b>Modo do desenvolvedor</b> (canto de cima, à direita).
          </li>
          <li>
            Clique em <b>Carregar sem compactação</b> e escolha a pasta extraída (a que tem o <code className="rounded bg-black/40 px-1">manifest.json</code>).
          </li>
          <li>
            Abra o Flow pelo ícone da extensão (<b>Abrir o Flow</b>), entre na sua conta Google e <b>abra (ou crie) um projeto</b>: o Zerum gera os vídeos dentro dele.
          </li>
          <li>
            Volte ao Zerum, recarregue a página e clique em <b>Conectar o Flow</b>. Quando aparecer “Flow conectado”, desligue a <b>Simulação local</b> em ⚙ para gerar de verdade.
          </li>
        </ol>
      </section>

      <section className={card}>
        <h2 className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-zinc-400">Antes de gerar de verdade</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm text-zinc-200">
          <li>Precisa de uma conta Google com <b>créditos do Flow</b>. Cada clipe de cena (até 8 s) gasta crédito dessa conta.</li>
          <li>Deixe a aba do Zerum <b>aberta</b> enquanto gera (ela leva as cenas à extensão e guarda o MP4) e a aba do Flow aberta (pode ficar em segundo plano, não minimizada).</li>
          <li>Se a cota do Flow acabar (erro 429), a conta fica em <b>pausa de 24 h</b>; a extensão não troca de conta sozinha para furar a cota.</li>
          <li>Se a extensão não responder em 25 s, o pedido fica preservado — nada é gerado de novo por conta própria.</li>
        </ul>
      </section>

      <p className="text-xs text-zinc-500">Se você abre o Zerum numa porta diferente da 3100, adicione o endereço em “Sites autorizados” no ícone da extensão.</p>
    </main>
  );
}
