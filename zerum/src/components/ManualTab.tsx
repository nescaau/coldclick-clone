'use client';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { ApiError, apiGet, apiPost, apiUpload } from '@/lib/client';
import { MAX_BATCH_NAME, MAX_QUANTITY, MAX_VIRAL_BYTES, MAX_VIRAL_MB } from '@/lib/limits';
import { PATHS, ROLETA_TOTAL, VARIATIONS, pedidoSummary, type PathId, type VariationId } from '@/lib/domain/plan';
import { LANGUAGES, balloonLabel, contrastText, sanitizeBatchName, sanitizeWord, type LanguageId } from '@/lib/domain/video-options';
import { DEFAULT_SETTINGS, type AvatarDTO, type BatchDTO, type SettingsDTO, type VideoOptions, type ViralDTO } from '@/lib/types';
import { LogPanel } from './LogPanel';
import { T } from './ui';

interface Props {
  virais: ViralDTO[];
  avatares: AvatarDTO[];
  /** Opções da conversa aberta (só a cor do balão é herdada — "a cor fica salva"). */
  opcoes: VideoOptions | null;
  onViralEnviado: () => void;
  onAbrirConfig: () => void;
  onCriado: (b: BatchDTO) => void;
}

const Passo = ({ n, children }: { n: number; children: string }) => (
  <h3 className="flex items-baseline gap-1 text-sm font-black uppercase tracking-wider text-white">
    <span>{n}</span>
    <span>.</span>
    <span>{children}</span>
  </h3>
);

/** Opção de botão (caminho / variação): marcador ●/○ + rótulo + descrição, como no original. */
function Opcao({ ativa, titulo, badge, children, onClick }: { ativa: boolean; titulo: string; badge?: string; children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={ativa} onClick={onClick} className={`w-full rounded-2xl p-3 text-left ${ativa ? T.opcaoAtiva : T.opcaoInativa}`}>
      <span className="flex flex-wrap items-center gap-2 text-sm font-black text-white">
        <span aria-hidden="true">{ativa ? '●' : '○'}</span>
        {titulo}
        {badge && <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px]">{badge}</span>}
      </span>
      <span className={`mt-1 block text-xs ${T.textoFraco}`}>{children}</span>
    </button>
  );
}

/** Aba MANUAL: 1. qual viral → 2. igual ou adaptado → 3. quem aparece e quantos → 4. gerar. Gerar cria o lote e abre a Produção. */
export function ManualTab({ virais, avatares, opcoes, onViralEnviado, onAbrirConfig, onCriado }: Props) {
  const [viralId, setViralId] = useState('');
  const [caminho, setCaminho] = useState<PathId>('igual');
  const [variacao, setVariacao] = useState<VariationId>('sem');
  const [marcados, setMarcados] = useState<string[]>([]);
  const [novos, setNovos] = useState(false);
  const [qtd, setQtd] = useState(3);
  const [palavra, setPalavra] = useState('');
  const [balao, setBalao] = useState(false);
  const [idioma, setIdioma] = useState<LanguageId>('en');
  const [notas, setNotas] = useState('');
  const [nome, setNome] = useState('');
  const [modeloAberto, setModeloAberto] = useState(false);
  const [settings, setSettings] = useState<SettingsDTO>(DEFAULT_SETTINGS);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [gerando, setGerando] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    apiGet<SettingsDTO>('/settings').then(setSettings).catch(() => undefined);
  }, []);

  const viral = virais.find((v) => v.id === viralId) ?? null;
  const nomesMarcados = avatares.filter((a) => marcados.includes(a.id)).map((a) => a.name);
  const params = {
    mode: 'viral' as const,
    viralId: viral?.id ?? null,
    quantity: qtd,
    path: caminho,
    variation: variacao,
    avatarIds: marcados,
    newAvatars: novos ? qtd : 0,
    language: idioma,
    word: palavra,
    batchName: nome,
    bubbleOn: balao,
    bubbleColor: opcoes?.bubbleColor ?? '#FFC400',
    notes: notas,
  };

  const faltas: string[] = [];
  if (!palavra.trim()) faltas.push('Qual palavra o público vai comentar?');
  if (!viral) faltas.push('Suba o viral (passo 1).');
  if (!novos && marcados.length === 0) faltas.push('Marque quem aparece (passo 3).');

  const enviarViral = async (f: File | undefined) => {
    if (!f) return;
    if (!/\.mp4$/i.test(f.name)) return setErro('Envie um arquivo .mp4.');
    if (f.size > MAX_VIRAL_BYTES) return setErro(`O vídeo passa de ${MAX_VIRAL_MB} MB.`);
    setErro('');
    setEnviando(true);
    try {
      const r = await apiUpload<{ viral: ViralDTO }>('/virals', f);
      setViralId(r.viral.id);
      onViralEnviado();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setEnviando(false);
    }
  };
  const aoSoltar = (e: DragEvent) => {
    e.preventDefault();
    setArrastando(false);
    void enviarViral(e.dataTransfer.files?.[0]);
  };

  const gerar = async () => {
    setErro('');
    setGerando(true);
    try {
      const b = await apiPost<BatchDTO>('/batches', {
        viralId,
        quantity: qtd,
        path: caminho,
        variation: variacao,
        avatarIds: novos ? [] : marcados,
        newAvatars: novos ? qtd : 0,
        options: { word: palavra, batchName: nome, bubbleOn: balao, bubbleColor: params.bubbleColor, language: idioma },
        notes: notas,
      });
      onCriado(b);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setGerando(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className={`space-y-6 p-6 ${T.cartao}`}>
        {/* 1. QUAL VIRAL? */}
        <section aria-label="Qual viral?" className="space-y-3">
          <Passo n={1}>QUAL VIRAL?</Passo>
          <p className={`text-sm ${T.textoSuave}`}>Suba o vídeo viral. A IA assiste, mostra gancho e estrutura (corrija em “Alterar análise” se ela errou). Com mais de um, marque qual é a base deste lote.</p>
          <input ref={fileRef} type="file" accept="video/mp4,.mp4" className="sr-only" aria-label="Escolher o vídeo viral" onChange={(e) => (void enviarViral(e.target.files?.[0]), (e.target.value = ''))} />
          {viral ? (
            <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/30 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-black text-white">{viral.name.replace(/\.mp4$/i, '')}</p>
                <p className={`text-xs ${T.textoFraco}`}>{viral.durationS !== null ? `${Math.round(viral.durationS)} s · ` : ''}lido ✓</p>
              </div>
              <button type="button" aria-label="Tirar o viral" title="Pra trocar, tire o atual no ✕." onClick={() => setViralId('')} className="rounded-lg p-1 text-zinc-300 hover:bg-white/10 hover:text-white">
                ✕
              </button>
            </div>
          ) : (
            <div
              role="button"
              tabIndex={0}
              aria-label="Arraste os vídeos virais pra cá ou clique pra escolher no computador"
              onClick={() => !enviando && fileRef.current?.click()}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileRef.current?.click()}
              onDragOver={(e) => (e.preventDefault(), setArrastando(true))}
              onDragLeave={() => setArrastando(false)}
              onDrop={aoSoltar}
              className={`flex min-h-[120px] cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl px-4 py-6 text-center ${arrastando ? T.dropArrastando : T.dropOcioso}`}
            >
              <span className="text-3xl" aria-hidden="true">
                ⬇️
              </span>
              <span className="text-base font-black text-white">{enviando ? 'Guardando o viral…' : 'Arraste os vídeos virais pra cá'}</span>
              <span className="text-xs text-zinc-300">ou clique pra escolher no computador</span>
              <span className="text-xs text-zinc-400">
                MP4 · um viral por vez (até <span>{MAX_VIRAL_MB}</span> MB). Pra trocar, tire o atual no ✕.
              </span>
            </div>
          )}
          {virais.length > 0 && (
            <div className="flex flex-wrap gap-2" role="listbox" aria-label="Virais já enviados">
              {virais.slice(0, 12).map((v) => (
                <button key={v.id} type="button" role="option" aria-selected={v.id === viralId} onClick={() => setViralId(v.id)} className={`rounded-full px-3 py-1 text-xs ${v.id === viralId ? T.pillAtiva : 'border border-white/15 text-zinc-300 hover:border-white/40'}`}>
                  {v.id === viralId ? '✓ base do lote' : 'usar este'} · {v.name.replace(/\.mp4$/i, '').slice(0, 28)}
                </button>
              ))}
            </div>
          )}
        </section>

        {/* 2. IGUAL OU ADAPTADO? */}
        <section aria-label="Igual ou adaptado?" className="space-y-3">
          <Passo n={2}>IGUAL OU ADAPTADO?</Passo>
          <div className="space-y-2">
            {PATHS.map((p) => (
              <Opcao key={p.id} ativa={caminho === p.id} titulo={p.label} badge={p.badge} onClick={() => setCaminho(p.id)}>
                {p.desc}
              </Opcao>
            ))}
          </div>
          <p className={`text-xs ${T.textoFraco}`}>
            Variação (opcional, por cima do <b className="text-white">igual</b>): muda pele, gesto ou palavras entre os vídeos — nunca o produto.
          </p>
          <div className="space-y-2">
            {VARIATIONS.map((v) => (
              <Opcao key={v.id} ativa={variacao === v.id} titulo={v.label} onClick={() => setVariacao(v.id)}>
                {v.id === 'roleta' ? (
                  <>
                    {v.desc} Nunca repete uma combinação sua (<span>{settings.roletaUsed}</span> de <span>{ROLETA_TOTAL}</span> usadas).
                  </>
                ) : (
                  v.desc
                )}
              </Opcao>
            ))}
          </div>
        </section>

        {/* 3. QUEM APARECE E QUANTOS? */}
        <section aria-label="Quem aparece e quantos?" className="space-y-3">
          <Passo n={3}>QUEM APARECE E QUANTOS?</Passo>
          <p className={`text-sm ${T.textoSuave}`}>
            <b className="text-white">Marque os avatares.</b> Só eles entram no vídeo — nenhum outro é acrescentado. (Viral com 2 pessoas e você marcou só 1: a ferramenta cria a 2ª no estilo do viral e avisa.)
          </p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Avatares">
            {avatares.map((a) => {
              const on = marcados.includes(a.id) && !novos;
              return (
                <button
                  key={a.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setNovos(false);
                    setMarcados((m) => (m.includes(a.id) ? m.filter((x) => x !== a.id) : [...m, a.id]));
                  }}
                  className={`rounded-full px-3 py-1.5 text-xs font-bold uppercase ${on ? T.pillAtiva : 'border border-white/15 text-zinc-200 hover:border-white/40'}`}
                >
                  {a.name}
                </button>
              );
            })}
            <button type="button" aria-pressed={novos} onClick={() => setNovos((n) => !n)} className={`rounded-full px-3 py-1.5 text-xs font-bold ${novos ? T.pillAtiva : 'border border-white/15 text-zinc-200 hover:border-white/40'}`}>
              🎲 {qtd} avatares novos
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm text-white">
              <span className={T.rotulo}>quantos vídeos</span>
              <input type="number" aria-label="Quantidade de vídeos" min={1} max={MAX_QUANTITY} value={qtd} onChange={(e) => setQtd(Math.max(1, Math.min(MAX_QUANTITY, Number(e.target.value) || 1)))} className={`mt-1 w-28 px-3 py-2 text-sm ${T.campo}`} />
            </label>
            <label className="block text-sm text-white">
              <span className={T.rotulo}>palavra do comentário</span>
              <input aria-label="Palavra do comentário" value={palavra} maxLength={24} placeholder="Qual palavra o público vai comentar?" onChange={(e) => setPalavra(sanitizeWord(e.target.value))} className={`mt-1 w-full px-3 py-2 text-sm ${T.campo}`} />
            </label>
          </div>

          <button type="button" aria-pressed={balao} onClick={() => setBalao((b) => !b)} className={`w-full rounded-2xl p-3 text-left ${balao ? T.opcaoAtiva : T.opcaoInativa}`}>
            <span className="flex flex-wrap items-center gap-2 text-sm font-black text-white">
              <span aria-hidden="true">💬</span>
              Balão COMMENT: {balao ? 'LIGADO' : 'DESLIGADO'} <span className="font-normal text-zinc-300">(toque pra {balao ? 'desligar' : 'ligar'})</span>
            </span>
            <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-white">
              Balão de comentário no vídeo
              <span className="rounded-full px-2 py-0.5 font-black" style={{ background: params.bubbleColor, color: contrastText(params.bubbleColor) }}>
                {balloonLabel(palavra)}
              </span>
              {balao ? 'ligado' : 'desligado'}
            </span>
            <span className={`mt-1 block text-xs ${T.textoFraco}`}>Opcional. Ligado, o balão aparece embaixo na hora em que a pessoa pede o comentário. Desligado, o vídeo sai só com a legenda.</span>
          </button>

          <div role="radiogroup" aria-label="Idioma do vídeo" className="space-y-2">
            <span className={T.rotulo}>IDIOMA DO VÍDEO</span>
            <div className="flex flex-wrap gap-2">
              {LANGUAGES.map((l) => (
                <label key={l.id} className={`cursor-pointer rounded-full px-4 py-2 text-sm font-bold ${idioma === l.id ? T.pillAtiva : 'border border-white/15 text-zinc-400 hover:border-white/40 hover:text-white'}`}>
                  <input type="radio" name="idioma-manual" value={l.id} checked={idioma === l.id} onChange={() => setIdioma(l.id)} className="sr-only" />
                  {l.nome}
                </label>
              ))}
            </div>
          </div>

          <label className="block text-sm text-white">
            <span className={T.rotulo}>observações (opcional) — o que você escrever aqui é lei pros roteiros e pras cenas</span>
            <textarea aria-label="Observações" value={notas} maxLength={1500} onChange={(e) => setNotas(e.target.value)} placeholder={'ex.: "sem o copo na mesa" · "mantém o frasco" · "fala em espanhol" · "5 de scrubs e 5 de moletom"'} className={`mt-1 h-20 w-full p-3 text-sm ${T.campo}`} />
          </label>
        </section>

        {/* 4. GERAR */}
        <section aria-label="Gerar" className="space-y-3">
          <Passo n={4}>GERAR</Passo>
          <p className={`text-xs ${T.textoSuave}`}>
            <b className={T.rotulo}>PEDIDO</b> · <span>{pedidoSummary(params, nomesMarcados, settings.imageModel)}</span>{' '}
            <button type="button" onClick={() => setModeloAberto((m) => !m)} aria-expanded={modeloAberto} className={T.link}>
              trocar modelo
            </button>
          </p>
          {modeloAberto && (
            <div role="dialog" aria-label="Modelo de vídeo padrão" className="flex items-start gap-2 rounded-xl border border-white/15 bg-black/40 p-3 text-xs text-zinc-200">
              <span aria-hidden="true">💡</span>
              <p className="flex-1">
                Por padrão o Omni 1.1 Flash vem selecionado — é muito superior e resolve a maioria dos problemas. Se quiser outro modelo,{' '}
                <button type="button" onClick={onAbrirConfig} className="underline hover:text-white">
                  clique aqui
                </button>
                .
              </p>
              <button type="button" aria-label="Fechar" onClick={() => setModeloAberto(false)} className="text-zinc-400 hover:text-white">
                ✕
              </button>
            </div>
          )}

          <label className="block text-sm text-white">
            Nome do lote (opcional)
            <input aria-label="Nome do lote" value={nome} maxLength={MAX_BATCH_NAME} placeholder="ex.: Umbigo" onChange={(e) => setNome(sanitizeBatchName(e.target.value))} className={`mt-1 w-full px-3 py-2 text-sm ${T.campo}`} />
            <span className={`mt-1 block text-xs ${T.textoFraco}`}>Com nome, os vídeos baixam como Nome_12345.mp4 (código diferente em cada vídeo). Até 40 letras/números.</span>
          </label>

          {faltas.length > 0 && (
            <p className="text-xs text-white">
              <span aria-hidden="true">ℹ</span> <b>Falta:</b> {faltas.join(' · ')}
            </p>
          )}
          {erro && (
            <p role="alert" className="text-sm text-zinc-200">
              ⚠ {erro}
            </p>
          )}
          <button type="button" onClick={() => void gerar()} disabled={faltas.length > 0 || gerando} className={`rounded-2xl px-8 py-4 text-base ${T.botaoPrimario}`}>
            GERAR {qtd} vídeo{qtd === 1 ? '' : 's'}
          </button>
          <p className={`text-xs ${T.textoFraco}`}>
            Escreve os roteiros (sem gastar crédito), gera {qtd} vídeo{qtd === 1 ? '' : 's'} só com quem você marcou e abre a Produção.
          </p>
        </section>
      </div>
      <LogPanel />
    </div>
  );
}
