'use client';
import { useEffect, useRef } from 'react';
import { LANGUAGES, type LanguageId, type VideoOptions } from '@/lib/domain/video-options';
import { MODE_LABELS, type DirectorMode } from '@/lib/domain/director';
import type { ConversationDetail, ViralDTO } from '@/lib/types';
import { Composer } from './Composer';
import { OptionsCard } from './OptionsCard';
import { PlanCard } from './PlanCard';
import { ViralCard } from './ViralCard';
import { T } from './ui';

interface Props {
  conv: ConversationDetail;
  ocupado: boolean;
  enviandoViral: boolean;
  enviandoPedido: boolean;
  onModo: (m: DirectorMode) => void;
  onOpcoes: (patch: Partial<VideoOptions>) => void;
  onArquivoViral: (f: File) => void;
  onAbrirBiblioteca: () => void;
  onTirarViral: () => void;
  onViralMudou: (v: ViralDTO) => void;
  onEnviar: (text: string, anexos: { nome: string }[]) => Promise<boolean>;
  onConfirmarPlano: (id: string) => void;
  onCancelarPlano: (id: string) => void;
  onAbrirProducao: () => void;
  onNova: () => void;
}

const Q = ({ children }: { children: string }) => <em className="not-italic font-semibold text-zinc-100">{children}</em>;

/** Texto introdutório do Diretor (literal do original). Só aparece antes da primeira mensagem. */
function Intro({ mode }: { mode: DirectorMode }) {
  if (mode === 'ideia') {
    return (
      <p className={`text-sm leading-relaxed ${T.textoSuave}`}>
        Não precisa de viral: descreva o vídeo que você quer e, se quiser, anexe uma imagem ou vídeo de referência no 📎. O Diretor propõe e, quando você aprovar, vira um lote.
      </p>
    );
  }
  return (
    <p className={`text-sm leading-relaxed ${T.textoSuave}`}>
      O Diretor vê os seus avatares, o lote aberto e os vídeos prontos, e faz por você:{' '}
      <Q>{'"cria uma enfermeira negra de 60 anos e um rapaz de camiseta branca, monta o lote com esse viral e gera 2 vídeos de cada"'}</Q>
      . Ele mostra os passos, você confirma, e a ferramenta executa. Arraste o vídeo viral e diga o que você quer
      {', ou crie a partir da sua ideia (sem viral). Exemplo: '}
      <Q>{'"quero esse vídeo igual, 3 vídeos, com pessoas novas"'}</Q>
      . O Diretor assiste ao viral, entende a estrutura dele e escreve as falas sobre o mesmo assunto — nunca cita marca nem produto. Depois é só
      refinar: <Q>{'"troca a abertura"'}</Q>, <Q>{'"faz 20"'}</Q>, <Q>{'"take único"'}</Q>.
    </p>
  );
}

/** Aba DIRETOR: modos, viral, opções do vídeo, conversa (com planos), idioma e pedido. */
export function DiretorPanel(p: Props) {
  const { conv } = p;
  const fimRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fimRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [conv.messages.length]);

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Como criar" className={`order-first grid grid-cols-2 gap-1 rounded-2xl p-1 ${T.barra}`}>
        {(['viral', 'ideia'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={conv.mode === m}
            disabled={p.ocupado}
            onClick={() => p.onModo(m)}
            className={`rounded-xl px-3 py-3 text-sm font-black ${conv.mode === m ? T.pillAtiva : 'text-zinc-300 hover:text-white'}`}
          >
            {MODE_LABELS[m]}
          </button>
        ))}
      </div>

      <div className={`space-y-4 p-5 ${T.cartao}`}>
        <div className="flex items-center justify-between gap-3">
          <h2 className={`text-xl ${T.titulo}`}>DIRETOR</h2>
          <button type="button" disabled={p.ocupado} onClick={p.onNova} className={`rounded-full px-3 py-1 text-xs ${T.botaoSecundario}`}>
            nova conversa
          </button>
        </div>

        {conv.mode === 'viral' && (
          <ViralCard
            viral={conv.viral}
            temMensagens={conv.messages.length > 0}
            enviando={p.enviandoViral}
            desabilitado={p.ocupado}
            onArquivo={p.onArquivoViral}
            onAbrirBiblioteca={p.onAbrirBiblioteca}
            onTirar={p.onTirarViral}
            onViralMudou={p.onViralMudou}
          />
        )}

        <OptionsCard key={conv.id} options={conv.options} desabilitado={p.ocupado} onChange={p.onOpcoes} />

        {conv.messages.length === 0 && <Intro mode={conv.mode} />}

        {conv.messages.length > 0 && (
          <ol aria-label="Conversa com o Diretor" className="space-y-3">
            {conv.messages.map((m) => (
              <li key={m.id} className={m.role === 'aluna' ? 'flex justify-end' : 'flex justify-start'}>
                <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${m.role === 'aluna' ? 'bg-white/10 text-white' : `${T.cartaoInterno} ${T.textoSuave}`}`}>
                  {m.role !== 'aluna' && <span className={`mb-1 block ${T.rotulo}`}>{m.role === 'diretor' ? 'Diretor' : 'Sistema'}</span>}
                  <p className="whitespace-pre-wrap">{m.text}</p>
                  {m.attachments.length > 0 && <p className="mt-1 text-xs text-zinc-400">📎 {m.attachments.map((a) => a.nome).join(', ')}</p>}
                  {m.plan && <PlanCard plan={m.plan} ocupado={p.ocupado || p.enviandoPedido} onConfirmar={p.onConfirmarPlano} onCancelar={p.onCancelarPlano} onAbrirProducao={p.onAbrirProducao} />}
                </div>
              </li>
            ))}
            <div ref={fimRef} />
          </ol>
        )}

        <div role="radiogroup" aria-label="Idioma da fala do vídeo" className="space-y-2">
          <span className={T.rotulo}>IDIOMA DO VÍDEO</span>
          <div className="flex flex-wrap gap-2">
            {LANGUAGES.map((l) => {
              const ativo = conv.options.language === l.id;
              return (
                <label
                  key={l.id}
                  className={`cursor-pointer rounded-full px-4 py-2 text-sm font-bold ${ativo ? T.pillAtiva : 'border border-white/15 text-zinc-400 hover:border-white/40 hover:text-white'}`}
                >
                  <input
                    type="radio"
                    name="idioma"
                    value={l.id}
                    checked={ativo}
                    disabled={p.ocupado}
                    onChange={() => p.onOpcoes({ language: l.id as LanguageId })}
                    className="sr-only"
                  />
                  {l.nome}
                </label>
              );
            })}
          </div>
        </div>

        <Composer mode={conv.mode} hasViral={!!conv.viral} enviando={p.enviandoPedido} onEnviar={p.onEnviar} />
      </div>
    </div>
  );
}
