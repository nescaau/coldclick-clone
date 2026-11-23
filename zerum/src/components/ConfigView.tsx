'use client';
import type { BridgeStatus } from '@/lib/bridge/status';
import { T } from './ui';

const LINHAS = [
  {
    nome: 'Acesso ao Zerum (login / assinatura 001)',
    estado: 'Não existe',
    texto: 'No original o servidor da 001.community confirmava a sessão do membro (e a assinatura) antes de gerar. Neste clone abre e usa — sem login, sem e-mail de assinatura.',
  },
  {
    nome: 'Antigravity (IA que escreve prompts e roteiros)',
    estado: 'Não existe',
    texto: 'O original pedia “Conectar Antigravity” (link + código). Aqui não há pareamento nem IA externa: o Diretor é local e só monta o lote.',
  },
  {
    nome: 'Flow (geração real, pela extensão)',
    estado: 'Fase futura',
    texto: 'A ponte site ⇄ extensão está desenhada (lib/bridge), mas ainda não há executor. Nenhuma chamada externa é feita.',
  },
];

/** Botão ⚙: o que o original travava e como está aqui. */
export function ConfigView({ ponte }: { ponte: BridgeStatus | null }) {
  return (
    <div className={`space-y-5 p-6 ${T.cartao}`}>
      <h2 className={`text-2xl ${T.titulo}`}>⚙ CONFIGURAÇÕES</h2>
      <ul className="space-y-3">
        {LINHAS.map((l) => (
          <li key={l.nome} className={`space-y-1 p-4 ${T.cartaoInterno}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-black text-white">{l.nome}</p>
              <span className="rounded-full border border-white/20 px-3 py-0.5 font-mono text-[10px] uppercase tracking-widest text-zinc-300">{l.estado}</span>
            </div>
            <p className={`text-xs ${T.textoFraco}`}>{l.texto}</p>
          </li>
        ))}
      </ul>
      <div className={`space-y-1 p-4 ${T.cartaoInterno}`}>
        <p className="text-sm font-black text-white">Dados locais</p>
        <p className={`text-xs ${T.textoFraco}`}>
          Conversas, lotes, avatares e virais ficam em <span className="font-mono text-zinc-200">zerum/data/</span> (banco <span className="font-mono text-zinc-200">zerum.db</span> e
          pasta <span className="font-mono text-zinc-200">virais/</span>). Nada sai deste computador.
        </p>
      </div>
      {ponte && (
        <p className={`font-mono text-[11px] ${T.textoMudo}`}>
          ponte: {ponte.ready ? 'ligada' : 'desligada'} · detalhe: {ponte.detail}
        </p>
      )}
    </div>
  );
}
