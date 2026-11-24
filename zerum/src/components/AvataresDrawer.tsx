'use client';
import { useRef, useState, type DragEvent } from 'react';
import { ApiError, apiDelete, apiPost, apiPut, apiUpload } from '@/lib/client';
import { BASE_PATH } from '@/lib/config.shared';
import { MAX_PHOTO_MB, GENDER_LABEL } from '@/lib/domain/avatar';
import { MAX_AVATAR_DESCRIPTION, MAX_AVATAR_NAME } from '@/lib/limits';
import type { AvatarDTO, Gender } from '@/lib/types';
import { Drawer, Icon, Modal, T, useTwoClick } from './ui';

interface Props {
  avatares: AvatarDTO[];
  onMudou: () => Promise<void> | void;
  onClose: () => void;
}

const FUTURO = 'Fase futura: gerar variações de rosto precisa do executor do Flow (extensão). Nada foi enviado a lugar nenhum.';

/** Diálogo AVATARES (painel lateral): biblioteca local com foto, criar/editar/remover, selecionar vários e zip. */
export function AvataresDrawer({ avatares, onMudou, onClose }: Props) {
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [editando, setEditando] = useState<AvatarDTO | 'novo' | null>(null);
  const [apagando, setApagando] = useState<AvatarDTO | null>(null);
  const [multi, setMulti] = useState(false);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [arrastando, setArrastando] = useState(false);
  const fotoRef = useRef<HTMLInputElement>(null);
  const dois = useTwoClick();

  const rodar = async (fn: () => Promise<unknown>, ok?: string) => {
    setAviso('');
    setOcupado(true);
    try {
      await fn();
      await onMudou();
      if (ok) setAviso(ok);
    } catch (e) {
      setAviso(`⚠ ${(e as Error).message}`);
    } finally {
      setOcupado(false);
    }
  };

  const enviarFoto = (f: File | undefined) => {
    if (!f) return;
    void rodar(() => apiUpload('/avatars/from-photo', f), 'Foto guardada neste computador. Abra o lápis para dar nome, escolher mulher ou homem e descrever.');
  };
  const aoSoltar = (e: DragEvent) => {
    e.preventDefault();
    setArrastando(false);
    enviarFoto(e.dataTransfer.files?.[0]);
  };

  const alternar = (id: string) =>
    setMarcados((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const baixarZip = () => {
    if (avatares.length === 0) return setAviso('Nenhum avatar salvo pra baixar.');
    window.location.assign(`${BASE_PATH}/api/avatars/zip`);
  };

  return (
    <Drawer titulo="AVATARES" onClose={onClose}>
      <div onDragOver={(e) => (e.preventDefault(), setArrastando(true))} onDragLeave={() => setArrastando(false)} onDrop={aoSoltar} className="space-y-5">
        <div className={`space-y-1 p-4 ${T.cartaoInterno}`}>
          <h2 className={`text-xl leading-tight ${T.titulo}`}>
            <span>MEUS</span> <span>AVATARES</span>
          </h2>
          <p className={`text-sm ${T.textoSuave}`}>
            <span>O rosto de cada vídeo.</span> <span>Mande sua foto ou gere do zero.</span> <span>Sempre pro público americano.</span>
          </p>
        </div>

        <div className={`space-y-3 p-4 ${arrastando ? T.dropArrastando : T.cartaoInterno}`}>
          <p className={T.rotulo}>
            <span>CRIAR</span> <span>AVATAR</span>
          </p>
          <input ref={fotoRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="Escolher a foto do avatar" onChange={(e) => (enviarFoto(e.target.files?.[0]), (e.target.value = ''))} />
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={ocupado} onClick={() => fotoRef.current?.click()} className={`flex items-center gap-2 rounded-2xl px-4 py-3 text-sm ${T.botaoSecundario}`}>
              <Icon name="add_a_photo" />
              Enviar minha foto
            </button>
            <button type="button" disabled={ocupado} onClick={() => void rodar(() => apiPost('/avatars/generate', { count: 1 }), 'Avatar criado sem foto: o rosto gerado pelo Flow é fase futura — abra o lápis para mandar uma foto.')} className={`rounded-2xl px-4 py-3 text-sm ${T.botaoSecundario}`}>
              ✨ Gerar 1
            </button>
            <button type="button" disabled={ocupado} onClick={() => void rodar(() => apiPost('/avatars/generate', { count: 4 }), '4 avatares criados sem foto: o rosto gerado pelo Flow é fase futura — abra o lápis de cada um para mandar uma foto.')} className={`rounded-2xl px-4 py-3 text-sm ${T.botaoSecundario}`}>
              ✨ Gerar 4
            </button>
            <button type="button" disabled={ocupado} onClick={() => setEditando('novo')} className={`rounded-2xl px-4 py-3 text-sm ${T.botaoSecundario}`}>
              ✎ Preencher à mão
            </button>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <button type="button" onClick={() => setAviso(FUTURO.replace('gerar variações de rosto', 'recuperar fotos da galeria do Flow'))} className={T.link}>
              Recuperar da galeria do Flow
            </button>
            <button type="button" onClick={baixarZip} className={T.link}>
              ⬇ Baixar todos (zip)
            </button>
          </div>
          <p className={`text-xs ${T.textoFraco}`}>Com a foto, a IA lê quem é e mostra: mesma pessoa, pessoa semelhante, o que você digitar e sugestões. Pode arrastar a foto aqui.</p>
        </div>

        {aviso && (
          <p role="status" className="rounded-xl border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs text-white">
            {aviso}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-pressed={multi}
            onClick={() => {
              setMulti((m) => !m);
              setMarcados(new Set());
            }}
            className={`rounded-full px-3 py-1.5 text-xs ${multi ? T.pillAtiva : T.botaoSecundario}`}
          >
            ☑ Selecionar vários
          </button>
          {multi && marcados.size > 0 && (
            <button
              type="button"
              disabled={ocupado}
              onClick={() => {
                if (!dois.arm('marcados')) return;
                void rodar(async () => {
                  await apiPost('/avatars/bulk-delete', { ids: [...marcados] });
                  setMarcados(new Set());
                  setMulti(false);
                });
              }}
              className={`rounded-full px-3 py-1.5 text-xs font-bold ${dois.armed === 'marcados' ? 'animate-pulse bg-white text-black' : 'border border-red-400/60 text-red-200'}`}
            >
              {dois.armed === 'marcados' ? `apagar ${marcados.size}? clique de novo` : `🗑 Apagar ${marcados.size} selecionad${marcados.size === 1 ? 'o' : 'os'}`}
            </button>
          )}
        </div>

        <div>
          <p className={`mb-2 ${T.rotulo}`}>
            <span>{avatares.length}</span> <span>AVATARES</span>
          </p>
          {avatares.length === 0 && <p className={`text-sm ${T.textoFraco}`}>Nenhum avatar ainda. Mande a sua foto, gere do zero ou preencha à mão.</p>}
          {/* Densidade do original: ~2 cartões por linha em tela estreita (r4) e 4 em tela larga (r10); foto em pé 9:16. */}
          <ul className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {avatares.map((a) => {
              const marcado = marcados.has(a.id);
              return (
                <li key={a.id} className={`overflow-hidden rounded-2xl border ${marcado ? 'border-white' : 'border-white/10'} bg-white/[0.03]`}>
                  <div
                    className="relative aspect-[9/16] w-full cursor-default bg-black/40"
                    onClick={() => multi && alternar(a.id)}
                    role={multi ? 'checkbox' : undefined}
                    aria-checked={multi ? marcado : undefined}
                    aria-label={multi ? `Selecionar ${a.name}` : undefined}
                  >
                    {a.hasPhoto ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`${BASE_PATH}/api/avatars/${a.id}/photo`} alt={a.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs text-zinc-500">Sem foto</div>
                    )}
                    {multi && <span className={`absolute left-2 top-2 flex h-5 w-5 items-center justify-center rounded border text-xs ${marcado ? 'border-white bg-white text-black' : 'border-white/60 bg-black/60'}`}>{marcado ? '✓' : ''}</span>}
                  </div>
                  <div className="space-y-1 p-2">
                    <div className="flex items-center justify-between gap-1">
                      <p className="truncate text-xs font-black text-white" title={a.name}>
                        {a.name}
                      </p>
                      <span className="flex shrink-0">
                        <button type="button" aria-label={`Editar ${a.name}`} title="Editar" onClick={() => setEditando(a)} className="rounded p-0.5 text-zinc-300 hover:text-white">
                          <Icon name="edit" className="!text-[18px]" />
                        </button>
                        <button type="button" aria-label={`Apagar ${a.name}`} title="Apagar" onClick={() => setApagando(a)} className="rounded p-0.5 text-zinc-300 hover:text-white">
                          <Icon name="delete" className="!text-[18px]" />
                        </button>
                      </span>
                    </div>
                    <p className={T.rotulo}>{a.gender ? GENDER_LABEL[a.gender] : 'SEXO?'}</p>
                    <div className="flex flex-col gap-1">
                      <button type="button" onClick={() => setAviso(FUTURO)} className="rounded-lg border border-white/15 px-2 py-1 text-left text-[10px] text-zinc-200 hover:border-white/40">
                        👤 Mesma pessoa, outro visual
                      </button>
                      <button type="button" onClick={() => setAviso(FUTURO)} className="rounded-lg border border-white/15 px-2 py-1 text-left text-[10px] text-zinc-200 hover:border-white/40">
                        👥 Pessoa nova parecida
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {editando && (
        <EditarAvatar
          avatar={editando === 'novo' ? null : editando}
          onClose={() => setEditando(null)}
          onSalvo={async () => {
            setEditando(null);
            await onMudou();
          }}
        />
      )}
      {apagando && (
        <Modal titulo="Apagar avatar" onClose={() => setApagando(null)} largura="max-w-md">
          <div className="space-y-4">
            <p className={`text-sm ${T.textoSuave}`}>
              Apagar “<b className="text-white">{apagando.name}</b>”? {apagando.hasPhoto ? 'A foto sai só deste computador e não dá pra desfazer.' : 'Não dá pra desfazer.'}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  const a = apagando;
                  setApagando(null);
                  void rodar(() => apiDelete(`/avatars/${a.id}`));
                }}
                className={`rounded-xl px-5 py-2 text-sm ${T.botaoPrimario}`}
              >
                Apagar
              </button>
              <button type="button" onClick={() => setApagando(null)} className={`rounded-xl px-4 py-2 text-sm ${T.botaoVidro}`}>
                Cancelar
              </button>
            </div>
          </div>
        </Modal>
      )}
    </Drawer>
  );
}

/** Formulário do lápis do cartão (ou "Preencher à mão"): nome, sexo, descrição e foto. */
function EditarAvatar({ avatar, onClose, onSalvo }: { avatar: AvatarDTO | null; onClose: () => void; onSalvo: () => Promise<void> }) {
  const [nome, setNome] = useState(avatar?.name ?? '');
  const [genero, setGenero] = useState<Gender>(avatar?.gender ?? '');
  const [desc, setDesc] = useState(avatar?.description ?? '');
  const [foto, setFoto] = useState<File | null>(null);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const salvar = async () => {
    setErro('');
    if (!nome.trim()) return setErro('Dê um nome ao avatar');
    if (!genero) return setErro('Escolha se a pessoa é mulher ou homem (campo Sexo) antes de salvar.');
    setSalvando(true);
    try {
      const body = { name: nome, description: desc, gender: genero };
      const salvo = avatar ? await apiPut<AvatarDTO>(`/avatars/${avatar.id}`, body) : await apiPost<AvatarDTO>('/avatars', body);
      if (foto) await apiUpload(`/avatars/${salvo.id}/photo`, foto);
      await onSalvo();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : (e as Error).message);
      setSalvando(false);
    }
  };

  return (
    <Modal titulo={avatar ? 'Editar avatar' : 'Preencher à mão'} onClose={onClose} largura="max-w-md">
      <div className="space-y-3">
        <label className="block text-sm text-white">
          Nome
          <input aria-label="Nome do avatar" value={nome} maxLength={MAX_AVATAR_NAME} onChange={(e) => setNome(e.target.value)} className={`mt-1 w-full px-3 py-2 text-sm ${T.campo}`} />
        </label>
        <div role="radiogroup" aria-label="Sexo" className="flex items-center gap-2">
          <span className="text-sm text-white">Sexo</span>
          {(['mulher', 'homem'] as const).map((g) => (
            <button key={g} type="button" role="radio" aria-checked={genero === g} onClick={() => setGenero(g)} className={`rounded-full px-4 py-1.5 text-xs font-bold ${genero === g ? T.pillAtiva : 'border border-white/15 text-zinc-300'}`}>
              {g === 'mulher' ? 'Mulher' : 'Homem'}
            </button>
          ))}
        </div>
        <label className="block text-sm text-white">
          Descrição
          <textarea
            aria-label="Descrição do avatar"
            value={desc}
            maxLength={MAX_AVATAR_DESCRIPTION}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="Etnia como o americano diz (Latina, Black American, white American...), rosto, pele, cabelo, maquiagem. Ex.: mulher latina, cabelo castanho ondulado, pele morena, maquiagem leve"
            className={`mt-1 h-24 w-full p-3 text-xs ${T.campo}`}
          />
        </label>
        <div>
          <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="Foto de referência" onChange={(e) => setFoto(e.target.files?.[0] ?? null)} />
          <button type="button" onClick={() => inputRef.current?.click()} className={`rounded-xl px-4 py-2 text-xs ${T.botaoVidro}`}>
            Subir foto
          </button>
          <p className={`mt-1 text-xs ${T.textoFraco}`}>
            {foto ? `Escolhida: ${foto.name}` : avatar?.hasPhoto ? 'Já tem foto. Escolha outra só se quiser trocar.' : `Foto de referência (opcional): arraste aqui ou clique. JPG, PNG ou WEBP até ${MAX_PHOTO_MB} MB.`}
          </p>
        </div>
        {erro && (
          <p role="alert" className="text-sm text-zinc-200">
            ⚠ {erro}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={salvando} onClick={() => void salvar()} className={`rounded-xl px-5 py-2 text-sm ${T.botaoPrimario}`}>
            {!avatar && !foto ? 'Salvar sem foto mesmo' : 'Salvar'}
          </button>
          <button type="button" onClick={onClose} className={`rounded-xl px-4 py-2 text-sm ${T.botaoVidro}`}>
            Cancelar
          </button>
        </div>
      </div>
    </Modal>
  );
}
