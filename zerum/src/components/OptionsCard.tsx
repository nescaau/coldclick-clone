'use client';
import { useEffect, useRef, useState } from 'react';
import { MAX_BATCH_NAME } from '@/lib/limits';
import {
  BALLOON_COLORS,
  DEFAULT_BALLOON_COLOR,
  balloonLabel,
  contrastText,
  normalizeHex,
  optionsSummary,
  sanitizeBatchName,
  sanitizeWord,
  type VideoOptions,
} from '@/lib/domain/video-options';
import { Icon, T } from './ui';

interface Props {
  options: VideoOptions;
  desabilitado: boolean;
  onChange: (patch: Partial<VideoOptions>) => void;
}

/** Chip COMMENT "PALAVRA" na cor escolhida, com contraste automático. */
function BalloonChip({ word, color }: { word: string; color: string }) {
  return (
    <span className="rounded-full px-2 py-0.5 text-[11px] font-black" style={{ background: color, color: contrastText(color) }}>
      {balloonLabel(word)}
    </span>
  );
}

/** "⚙ Opções do vídeo": palavra, nome do lote, balão (liga/desliga) e cor. */
export function OptionsCard({ options, desabilitado, onChange }: Props) {
  const [aberto, setAberto] = useState(true);
  const [word, setWord] = useState(options.word);
  const [nome, setNome] = useState(options.batchName);
  const [hex, setHex] = useState(options.bubbleColor);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // `word`/`nome` nascem das opções e só mudam aqui (o pai remonta o componente por conversa via `key`);
  // sincronizar a cada resposta da API apagaria caracteres digitados durante o debounce.
  useEffect(() => setHex(options.bubbleColor), [options.bubbleColor]);

  const agendar = (patch: Partial<VideoOptions>) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onChange(patch), 400);
  };
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const prefixo = sanitizeBatchName(nome);
  const cor = options.bubbleColor;

  return (
    <section aria-label="Opções do vídeo" className={`overflow-hidden ${T.cartaoInterno}`}>
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-expanded={aberto}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span aria-hidden="true">⚙</span>
        <span className="text-sm font-black text-white">Opções do vídeo</span>
        <span className="min-w-0 flex-1 truncate text-xs text-zinc-400">{optionsSummary(options)}</span>
        <Icon name={aberto ? 'expand_less' : 'expand_more'} className="text-zinc-400" />
      </button>

      {aberto && (
        <div className="space-y-4 px-4 pb-4">
          <label className="block text-sm text-white">
            Palavra do comentário
            <input
              aria-label="Palavra do comentário"
              value={word}
              disabled={desabilitado}
              maxLength={24}
              placeholder="Sua palavra da automação"
              onChange={(e) => {
                const v = sanitizeWord(e.target.value);
                setWord(v);
                agendar({ word: v });
              }}
              onBlur={() => word !== options.word && onChange({ word })}
              className={`ml-2 w-56 px-3 py-2 text-sm ${T.campo}`}
            />
          </label>

          <div>
            <label className="block text-sm text-white">
              Nome do lote (opcional)
              <input
                aria-label="Nome do lote"
                value={nome}
                disabled={desabilitado}
                maxLength={MAX_BATCH_NAME}
                placeholder="ex.: Umbigo"
                onChange={(e) => {
                  const v = sanitizeBatchName(e.target.value);
                  setNome(v);
                  agendar({ batchName: v });
                }}
                onBlur={() => nome !== options.batchName && onChange({ batchName: nome })}
                className={`ml-2 w-48 px-3 py-2 text-sm ${T.campo}`}
              />
            </label>
            <span className={`mt-1 block text-xs ${T.textoFraco}`}>
              {prefixo ? (
                <>
                  Os vídeos baixam como <b className="font-mono text-white">{prefixo}_12345.mp4</b> (código diferente em cada vídeo).
                </>
              ) : (
                'Com nome, os vídeos baixam como Nome_12345.mp4 (código diferente em cada vídeo). Até 40 letras/números.'
              )}
            </span>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={options.bubbleOn}
            disabled={desabilitado}
            onClick={() => onChange({ bubbleOn: !options.bubbleOn })}
            className={`flex w-full items-center gap-3 rounded-2xl p-3 text-left ${options.bubbleOn ? T.opcaoAtiva : T.opcaoInativa}`}
          >
            <span className={`flex h-6 w-10 shrink-0 rounded-full p-0.5 ${options.bubbleOn ? 'justify-end bg-white' : 'justify-start bg-white/15'}`}>
              <span className={`h-5 w-5 rounded-full ${options.bubbleOn ? 'bg-black' : 'bg-white/60'}`} />
            </span>
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2 text-sm font-black text-white">
                Balão de comentário no vídeo
                <BalloonChip word={word} color={cor} />
                <span className="rounded bg-white/10 px-2 py-0.5 text-xs font-black">{options.bubbleOn ? 'LIGADO' : 'DESLIGADO'}</span>
              </span>
              <span className={`block text-xs ${T.textoFraco}`}>
                Opcional. Ligado, o balão aparece embaixo na hora em que a pessoa pede o comentário (com a palavra do lote). Desligado, o
                vídeo sai só com a legenda. Vale pros lotes que o Diretor montar a partir de agora.
              </span>
            </span>
          </button>

          {options.bubbleOn && (
            <div data-testid="cor-balao" className={`rounded-2xl p-3 ${T.opcaoInativa} !opacity-100`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="mr-1 text-xs font-black text-white">Cor do balão</span>
                {BALLOON_COLORS.map((c) => {
                  const ativa = cor.toUpperCase() === c.hex;
                  return (
                    <button
                      key={c.hex}
                      type="button"
                      aria-label={`Cor ${c.nome}`}
                      aria-pressed={ativa}
                      title={c.nome}
                      disabled={desabilitado}
                      onClick={() => onChange({ bubbleColor: c.hex })}
                      className={`h-7 w-7 rounded-full border ${ativa ? 'scale-110 border-white ring-2 ring-white/70' : 'border-white/30'}`}
                      style={{ background: c.hex }}
                    />
                  );
                })}
                <span className="ml-1 flex items-center gap-2" title="Cor livre">
                  <input
                    type="color"
                    aria-label="Cor livre do balão"
                    disabled={desabilitado}
                    value={cor.toLowerCase()}
                    onChange={(e) => onChange({ bubbleColor: normalizeHex(e.target.value) ?? DEFAULT_BALLOON_COLOR })}
                    className="h-7 w-7 rounded-md"
                  />
                  <input
                    aria-label="Cor do balão em hex"
                    value={hex}
                    disabled={desabilitado}
                    maxLength={7}
                    placeholder="#FFC400"
                    onChange={(e) => {
                      setHex(e.target.value);
                      const n = normalizeHex(e.target.value);
                      if (n) onChange({ bubbleColor: n });
                    }}
                    onBlur={() => setHex(options.bubbleColor)}
                    className={`w-24 px-2 py-1 font-mono text-xs ${T.campo}`}
                  />
                </span>
                <BalloonChip word={word} color={cor} />
              </div>
              <span className={`mt-1 block text-xs ${T.textoFraco}`}>
                Padrão: amarelo. O texto do balão e a setinha ajustam o contraste sozinhos. A cor fica salva e vale nos próximos lotes (Diretor e
                laboratório).
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
