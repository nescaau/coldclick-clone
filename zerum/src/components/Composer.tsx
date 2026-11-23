'use client';
import { useRef, useState } from 'react';
import { composerPlaceholder, type DirectorMode } from '@/lib/domain/director';
import { MAX_MESSAGE_CHARS } from '@/lib/limits';
import { Icon, T } from './ui';

interface Props {
  mode: DirectorMode;
  hasViral: boolean;
  enviando: boolean;
  onEnviar: (text: string, anexos: { nome: string }[]) => Promise<boolean>;
}

/** Campo "Pedido ao Diretor" + 📎 (anexa só o NOME nesta fase) + Enviar (Enter envia). */
export function Composer({ mode, hasViral, enviando, onEnviar }: Props) {
  const [texto, setTexto] = useState('');
  const [anexos, setAnexos] = useState<{ nome: string }[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const ideia = mode === 'ideia';

  const enviar = async () => {
    if (enviando || (!texto.trim() && anexos.length === 0)) return;
    const ok = await onEnviar(texto, anexos);
    if (ok) {
      setTexto('');
      setAnexos([]);
    }
  };

  return (
    <div className="space-y-2">
      {anexos.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Anexos do pedido">
          {anexos.map((a, i) => (
            <li key={`${a.nome}-${i}`} className="flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-xs text-white">
              📎 {a.nome}
              <button type="button" aria-label={`Remover ${a.nome}`} onClick={() => setAnexos((l) => l.filter((_, j) => j !== i))}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*"
          multiple
          className="sr-only"
          aria-label="Anexar imagem ou vídeo de referência"
          onChange={(e) => {
            const nomes = Array.from(e.target.files ?? []).map((f) => ({ nome: f.name.slice(0, 200) }));
            e.target.value = '';
            setAnexos((l) => [...l, ...nomes].slice(0, 8));
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          aria-label="Anexar"
          title="Anexar imagem/vídeo de referência"
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${T.botaoVidro}`}
        >
          <Icon name="attach_file" />
        </button>
        <textarea
          aria-label="Pedido ao Diretor"
          value={texto}
          maxLength={MAX_MESSAGE_CHARS}
          placeholder={composerPlaceholder(mode, hasViral)}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void enviar();
            }
          }}
          className={`flex-1 rounded-2xl p-3 ${ideia ? 'h-32 text-base' : 'h-14 text-sm'} ${T.campo}`}
        />
        <button
          type="button"
          onClick={() => void enviar()}
          disabled={enviando || (!texto.trim() && anexos.length === 0)}
          className={`h-11 shrink-0 rounded-2xl px-6 text-sm ${T.botaoPrimario}`}
        >
          Enviar
        </button>
      </div>
    </div>
  );
}
