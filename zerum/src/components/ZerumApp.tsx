'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiDelete, apiGet, apiPatch, apiPost, apiUpload } from '@/lib/client';
import { MAX_VIRAL_BYTES, MAX_VIRAL_MB } from '@/lib/limits';
import type { BridgeStatus } from '@/lib/bridge/status';
import type {
  BatchDTO,
  ConversationDetail,
  ConversationSummary,
  DirectorMode,
  SendMessageResult,
  VideoOptions,
  ViralDTO,
} from '@/lib/types';
import { AnalisadosTab } from './AnalisadosTab';
import { AvataresView } from './AvataresView';
import { ConfigView } from './ConfigView';
import { ConversationSidebar } from './ConversationSidebar';
import { DiretorPanel } from './DiretorPanel';
import { FlowBanner } from './FlowBanner';
import { FlowModal } from './FlowModal';
import { BridgePill, ContasPanels, HelpButtons } from './FloatingDock';
import { Header, type Aba, type Visao } from './Header';
import { ManualTab } from './ManualTab';
import { ProducaoTab } from './ProducaoTab';
import { VideosTab } from './VideosTab';
import { ViralPicker } from './ViralPicker';
import { T } from './ui';

const LS_CONV = 'zerum:conversa';
const LS_ABA = 'zerum:aba';
const ABAS_VALIDAS: Aba[] = ['diretor', 'manual', 'producao', 'analisados', 'videos'];

const lsGet = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* sem storage: tudo continua funcionando, só não lembra a escolha */
  }
};

/** Estúdio Zerum: controlador de estado da tela única (Diretor / Manual / Produção / Analisados / Vídeos / Avatares / ⚙). */
export function ZerumApp() {
  const [aba, setAba] = useState<Aba>('diretor');
  const [visao, setVisao] = useState<Visao>('estudio');
  const [convs, setConvs] = useState<ConversationSummary[]>([]);
  const [conv, setConv] = useState<ConversationDetail | null>(null);
  const [virais, setVirais] = useState<ViralDTO[]>([]);
  const [lotes, setLotes] = useState<BatchDTO[]>([]);
  const [ponte, setPonte] = useState<BridgeStatus | null>(null);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [enviandoViral, setEnviandoViral] = useState(false);
  const [enviandoPedido, setEnviandoPedido] = useState(false);
  const [flowAberto, setFlowAberto] = useState(false);
  const [bibliotecaAberta, setBibliotecaAberta] = useState(false);
  const bootRef = useRef(false);

  const refreshPonte = useCallback(async () => {
    try {
      setPonte(await apiGet<BridgeStatus>('/bridge/status'));
    } catch {
      setPonte(null);
    }
  }, []);

  const refreshListas = useCallback(async () => {
    const [c, v, l] = await Promise.all([
      apiGet<ConversationSummary[]>('/conversations'),
      apiGet<ViralDTO[]>('/virals'),
      apiGet<BatchDTO[]>('/batches'),
    ]);
    setConvs(c);
    setVirais(v);
    setLotes(l);
    return c;
  }, []);

  const abrir = useCallback(async (id: string) => {
    const d = await apiGet<ConversationDetail>(`/conversations/${id}`);
    setConv(d);
    lsSet(LS_CONV, d.id);
  }, []);

  // Boot: carrega tudo; sem nenhuma conversa, abre a primeira ("Nova conversa"), como o original.
  useEffect(() => {
    if (bootRef.current) return;
    bootRef.current = true;
    const salva = lsGet(LS_ABA) as Aba | null;
    if (salva && ABAS_VALIDAS.includes(salva)) setAba(salva);
    (async () => {
      try {
        void refreshPonte();
        let lista = await refreshListas();
        if (lista.length === 0) {
          const nova = await apiPost<ConversationDetail>('/conversations', {});
          lista = await refreshListas();
          setConv(nova);
          lsSet(LS_CONV, nova.id);
          return;
        }
        const lembrada = lsGet(LS_CONV);
        await abrir(lista.find((c) => c.id === lembrada)?.id ?? lista[0].id);
      } catch (e) {
        setErro((e as Error).message);
      }
    })();
  }, [abrir, refreshListas, refreshPonte]);

  const mudarAba = (a: Aba) => {
    setAba(a);
    lsSet(LS_ABA, a);
  };

  /** Executa uma mutação mostrando erro no banner e travando os controles enquanto roda. */
  const mutar = useCallback(
    async (fn: () => Promise<void>) => {
      setErro('');
      setOcupado(true);
      try {
        await fn();
      } catch (e) {
        setErro((e as Error).message);
      } finally {
        setOcupado(false);
      }
    },
    [],
  );

  const nova = () =>
    mutar(async () => {
      const d = await apiPost<ConversationDetail>('/conversations', { mode: conv?.mode ?? 'viral' });
      setConv(d);
      lsSet(LS_CONV, d.id);
      await refreshListas();
      mudarAba('diretor');
    });

  const renomear = (id: string, title: string) =>
    mutar(async () => {
      const d = await apiPatch<ConversationDetail>(`/conversations/${id}`, { title });
      if (conv?.id === id) setConv(d);
      await refreshListas();
    });

  const apagar = (id: string) =>
    mutar(async () => {
      await apiDelete(`/conversations/${id}`);
      const lista = await refreshListas();
      if (conv?.id !== id) return;
      if (lista.length === 0) {
        const d = await apiPost<ConversationDetail>('/conversations', {});
        setConv(d);
        await refreshListas();
      } else {
        await abrir(lista[0].id);
      }
    });

  const patchConv = (patch: Record<string, unknown>) =>
    mutar(async () => {
      if (!conv) return;
      const d = await apiPatch<ConversationDetail>(`/conversations/${conv.id}`, patch);
      setConv(d);
      lsSet(LS_CONV, d.id);
      await refreshListas();
    });

  const setModo = (m: DirectorMode) => patchConv({ mode: m });
  /** Opções salvam "em silêncio": travar os campos (ocupado) tiraria o foco de quem está digitando. */
  const setOpcoes = async (patch: Partial<VideoOptions>) => {
    if (!conv) return;
    try {
      setConv(await apiPatch<ConversationDetail>(`/conversations/${conv.id}`, { options: patch }));
    } catch (e) {
      setErro((e as Error).message);
    }
  };

  const enviarViral = async (file: File) => {
    if (!conv) return;
    if (!/\.mp4$/i.test(file.name)) return setErro('Envie um arquivo .mp4.');
    if (file.size > MAX_VIRAL_BYTES) return setErro(`O vídeo passa de ${MAX_VIRAL_MB} MB.`);
    setErro('');
    setEnviandoViral(true);
    try {
      const r = await apiUpload<{ conversation: ConversationDetail }>(`/conversations/${conv.id}/viral`, file);
      setConv(r.conversation);
      lsSet(LS_CONV, r.conversation.id);
      await refreshListas();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviandoViral(false);
    }
  };

  const usarViral = (v: ViralDTO) =>
    mutar(async () => {
      if (!conv) return;
      const d = await apiPatch<ConversationDetail>(`/conversations/${conv.id}`, { viralId: v.id, mode: 'viral' });
      setConv(d);
      lsSet(LS_CONV, d.id);
      setBibliotecaAberta(false);
      mudarAba('diretor');
      setVisao('estudio');
      await refreshListas();
    });

  const enviarPedido = async (text: string, anexos: { nome: string }[]): Promise<boolean> => {
    if (!conv) return false;
    setErro('');
    setEnviandoPedido(true);
    try {
      const r = await apiPost<SendMessageResult>(`/conversations/${conv.id}/messages`, { text, attachments: anexos });
      setConv(r.conversation);
      await refreshListas();
      return true;
    } catch (e) {
      setErro((e as Error).message);
      return false;
    } finally {
      setEnviandoPedido(false);
    }
  };

  const tabsFora = (
    <>
      {aba === 'manual' && (
        <ManualTab
          virais={virais}
          opcoes={conv?.options ?? null}
          onCriado={() => {
            void refreshListas();
            mudarAba('producao');
          }}
        />
      )}
      {aba === 'producao' && <ProducaoTab lotes={lotes} onMudou={() => void refreshListas()} />}
      {aba === 'analisados' && (
        <AnalisadosTab
          virais={virais}
          onMudou={() => void refreshListas()}
          onUsar={(v) => {
            void usarViral(v);
          }}
        />
      )}
      {aba === 'videos' && <VideosTab />}
    </>
  );

  return (
    <div className="min-h-screen bg-[#0a0a0b] pb-28 text-white">
      <Header aba={aba} visao={visao} onAba={mudarAba} onVisao={setVisao} />

      <main className="mx-auto max-w-[1600px] space-y-4 px-4 py-4 sm:px-6">
        <FlowBanner onOpen={() => setFlowAberto(true)} />

        {erro && (
          <div role="alert" className={`flex items-start justify-between gap-3 px-4 py-3 text-sm text-zinc-100 ${T.cartaoInterno}`}>
            <span>⚠ {erro}</span>
            <button type="button" onClick={() => setErro('')} aria-label="Fechar aviso" className="text-zinc-400 hover:text-white">
              ×
            </button>
          </div>
        )}

        {visao === 'avatares' && <AvataresView />}
        {visao === 'config' && <ConfigView ponte={ponte} />}
        {visao === 'estudio' &&
          (aba === 'diretor' ? (
            <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:items-start lg:gap-5">
              <ConversationSidebar
                itens={convs}
                atual={conv?.id ?? ''}
                ocupado={ocupado || enviandoPedido || enviandoViral}
                onAbrir={(id) => void mutar(() => abrir(id))}
                onNova={() => void nova()}
                onRenomear={(id, t) => void renomear(id, t)}
                onApagar={(id) => void apagar(id)}
              />
              {conv ? (
                <DiretorPanel
                  conv={conv}
                  ocupado={ocupado || enviandoPedido || enviandoViral}
                  enviandoViral={enviandoViral}
                  enviandoPedido={enviandoPedido}
                  onModo={(m) => void setModo(m)}
                  onOpcoes={(p) => void setOpcoes(p)}
                  onArquivoViral={(f) => void enviarViral(f)}
                  onAbrirBiblioteca={() => setBibliotecaAberta(true)}
                  onTirarViral={() => void patchConv({ viralId: null })}
                  onEnviar={enviarPedido}
                />
              ) : (
                <p className={`p-6 text-sm ${T.textoFraco}`}>Carregando…</p>
              )}
            </div>
          ) : (
            tabsFora
          ))}
      </main>

      <HelpButtons />
      <BridgePill status={ponte} onClick={() => setFlowAberto(true)} />
      <ContasPanels onAtualizar={refreshPonte} />

      {flowAberto && <FlowModal status={ponte} onRetry={refreshPonte} onClose={() => setFlowAberto(false)} />}
      {bibliotecaAberta && <ViralPicker virais={virais} atualId={conv?.viral?.id ?? null} onUsar={(v) => void usarViral(v)} onClose={() => setBibliotecaAberta(false)} />}
    </div>
  );
}
