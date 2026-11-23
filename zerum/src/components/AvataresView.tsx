'use client';
import { useCallback, useEffect, useState } from 'react';
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/client';
import { MAX_AVATAR_DESCRIPTION, MAX_AVATAR_NAME } from '@/lib/limits';
import type { AvatarDTO } from '@/lib/types';
import { T } from './ui';

/** Botão "Avatares": biblioteca local (nome + descrição). A foto original no Flow é fase futura. */
export function AvataresView() {
  const [lista, setLista] = useState<AvatarDTO[] | null>(null);
  const [nome, setNome] = useState('');
  const [desc, setDesc] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    try {
      setLista(await apiGet<AvatarDTO[]>('/avatars'));
    } catch (e) {
      setErro((e as Error).message);
    }
  }, []);
  useEffect(() => void carregar(), [carregar]);

  const salvar = async () => {
    setErro('');
    try {
      if (editId) await apiPut(`/avatars/${editId}`, { name: nome, description: desc });
      else await apiPost('/avatars', { name: nome, description: desc });
      setNome('');
      setDesc('');
      setEditId(null);
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    }
  };

  return (
    <div className={`space-y-5 p-6 ${T.cartao}`}>
      <h2 className={`text-2xl ${T.titulo}`}>AVATARES</h2>
      <p className={`text-sm ${T.textoSuave}`}>
        As pessoas que aparecem nos seus vídeos. Aqui ficam só o nome e a descrição, neste computador — a foto original no Flow chega com o executor (fase
        futura).
      </p>

      <div className={`space-y-3 p-4 ${T.cartaoInterno}`}>
        <label className="block text-sm text-white">
          Nome
          <input
            aria-label="Nome do avatar"
            value={nome}
            maxLength={MAX_AVATAR_NAME}
            onChange={(e) => setNome(e.target.value)}
            placeholder="ex.: Loretta"
            className={`mt-1 w-full px-3 py-2 text-sm ${T.campo}`}
          />
        </label>
        <label className="block text-sm text-white">
          Descrição
          <textarea
            aria-label="Descrição do avatar"
            value={desc}
            maxLength={MAX_AVATAR_DESCRIPTION}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="ex.: enfermeira de 60 anos, cabelo grisalho, jaleco branco"
            className={`mt-1 h-20 w-full p-3 text-sm ${T.campo}`}
          />
        </label>
        {erro && (
          <p role="alert" className="text-sm text-zinc-200">
            ⚠ {erro}
          </p>
        )}
        <div className="flex gap-2">
          <button type="button" onClick={salvar} disabled={!nome.trim()} className={`rounded-xl px-5 py-2 text-sm ${T.botaoPrimario}`}>
            {editId ? 'Salvar avatar' : 'Criar avatar'}
          </button>
          {editId && (
            <button
              type="button"
              onClick={() => {
                setEditId(null);
                setNome('');
                setDesc('');
              }}
              className={`rounded-xl px-4 py-2 text-sm ${T.botaoVidro}`}
            >
              Cancelar
            </button>
          )}
        </div>
      </div>

      {lista && lista.length === 0 && <p className={`text-sm ${T.textoFraco}`}>Nenhum avatar ainda. Crie o primeiro acima.</p>}
      <ul className="grid gap-3 sm:grid-cols-2">
        {(lista ?? []).map((a) => (
          <li key={a.id} className={`space-y-1 p-4 ${T.cartaoInterno}`}>
            <p className="text-sm font-black text-white">{a.name}</p>
            <p className={`text-xs ${T.textoFraco}`}>{a.description || 'Sem descrição.'}</p>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setEditId(a.id);
                  setNome(a.name);
                  setDesc(a.description);
                }}
                className={`rounded-xl px-3 py-1 text-xs ${T.botaoVidro}`}
              >
                Editar
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!confirm(`Apagar o avatar “${a.name}”?`)) return;
                  await apiDelete(`/avatars/${a.id}`);
                  await carregar();
                }}
                className={`rounded-xl px-3 py-1 text-xs ${T.botaoVidro}`}
              >
                Apagar
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
