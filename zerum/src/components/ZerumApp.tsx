'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiDelete, apiGet, apiPatch, apiPost, apiUpload } from '@/lib/client';
import { MAX_VIRAL_BYTES, MAX_VIRAL_MB } from '@/lib/limits';
import type {
  AvatarDTO,
  BatchDTO,
  ConversationDetail,
  ConversationSummary,
  DirectorMode,
  SendMessageResult,
  SettingsDTO,
  VideoOptions,
  ViralDTO,
} from '@/lib/types';
import { AnalisadosTab } from './AnalisadosTab';
import { AvataresDrawer } from './AvataresDrawer';
import { LS_CONTA_FLOW, lerContaEscolhida, useBridge } from './BridgeRunner';
import { ConfigDrawer } from './ConfigDrawer';
import { ConversationSidebar } from './ConversationSidebar';
import { DiretorPanel } from './DiretorPanel';
import { FlowBanner } from './FlowBanner';
import { FlowModal } from './FlowModal';
import { BridgePill, ContasPanels, HelpButtons } from './FloatingDock';
import { Header, type Aba, type Gaveta } from './Header';
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

const loteAtivo = (l: BatchDTO) => l.state === 'rodando' || l.state === 'na_fila' || l.state === 'preparando';

/** Estúdio Zerum: controlador de estado da tela única (Diretor / Manual / Produção / Analisados / Vídeos + Avatares e ⚙ em painel lateral). */
export function ZerumApp() {
  const [aba, setAba] = useState<Aba>('diretor');
  const [gaveta, setGaveta] = useState<Gaveta>(null);
  const [convs, setConvs] = useState<ConversationSummary[]>([]);
  const [conv, setConv] = useState<ConversationDetail | null>(null);
  const [virais, setVirais] = useState<ViralDTO[] | null>(null);
  const [lotes, setLotes] = useState<BatchDTO[]>([]);
  const [avatares, setAvatares] = useState<AvatarDTO[]>([]);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [enviandoViral, setEnviandoViral] = useState(false);
  const [enviandoPedido, setEnviandoPedido] = useState(false);
  const [flowAberto, setFlowAberto] = useState(false);
  const [bibliotecaAberta, setBibliotecaAberta] = useState(false);
  const [tick, setTick] = useState(0);
  const [simulacao, setSimulacao] = useState(true);
  const [contaEscolhida, setContaEscolhida] = useState('');
  const bootRef = useRef(false);

  const refreshLotes = useCallback(async () => {
    try {
      setLotes(await apiGet<BatchDTO[]>('/batches'));
    } catch {
      /* a próxima leitura tenta de novo */
    }
  }, []);

  /** A ponte com a extensão: estado real (pílula, barra, modal, contas) e a execução dos lotes pelo Flow quando a simulação está desligada. */
  const { status: ponte, atualizar: atualizarPonte } = useBridge(() => void refreshLotes());

  const refreshSettings = useCallback(async () => {
    try {
      setSimulacao((await apiGet<SettingsDTO>('/settings')).simulation);
    } catch {
      /* mantém o último valor conhecido */
    }
  }, []);

  const desligarSimulacao = useCallback(async () => {
    setSimulacao((await apiPatch<SettingsDTO>('/settings', { simulation: false })).simulation);
    void refreshLotes();
    void atualizarPonte();
  }, [atualizarPonte, refreshLotes]);

  const escolherConta = useCallback((email: string) => {
    setContaEscolhida(email);
    try {
      if (email) localStorage.setItem(LS_CONTA_FLOW, email);
      else localStorage.removeItem(LS_CONTA_FLOW);
    } catch {
      /* sem storage: vale só até recarregar */
    }
  }, []);

  const refreshAvatares = useCallback(async () => {
    setAvatares(await apiGet<AvatarDTO[]>('/avatars'));
  }, []);

  const refreshListas = useCallback(async () => {
    const [c, v, l, a] = await Promise.all([
      apiGet<ConversationSummary[]>('/conversations'),
      apiGet<ViralDTO[]>('/virals'),
      apiGet<BatchDTO[]>('/batches'),
      apiGet<AvatarDTO[]>('/avatars'),
    ]);
    setConvs(c);
    setVirais(v);
    setLotes(l);
    setAvatares(a);
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
    setContaEscolhida(lerContaEscolhida() ?? '');
    void refreshSettings();
    (async () => {
      try {
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
  }, [abrir, refreshListas, refreshSettings]);

  // Produção em tempo real: enquanto há lote ativo (ou a aba Produção está aberta) relê a cada 1,5 s.
  const haAtivo = lotes.some(loteAtivo);
  useEffect(() => {
    if (!haAtivo && aba !== 'producao') return;
    const t = setInterval(() => {
      void refreshLotes();
      setTick((n) => n + 1);
    }, 1500);
    return () => clearInterval(t);
  }, [haAtivo, aba, refreshLotes]);

  const mudarAba = (a: Aba) => {
    setAba(a);
    lsSet(LS_ABA, a);
    setGaveta(null);
    if (a === 'producao' || a === 'videos') void refreshLotes();
  };

  /** Executa uma mutação mostrando erro no banner e travando os controles enquanto roda. */
  const mutar = useCallback(async (fn: () => Promise<void>) => {
    setErro('');
    setOcupado(true);
    try {
      await fn();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }, []);

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

  const confirmarPlano = (id: string) =>
    mutar(async () => {
      const r = await apiPost<{ conversation: ConversationDetail; batch: BatchDTO }>(`/plans/${id}/confirm`);
      setConv(r.conversation);
      await refreshListas();
    });

  const cancelarPlano = (id: string) =>
    mutar(async () => {
      const r = await apiPost<{ conversation: ConversationDetail }>(`/plans/${id}/cancel`);
      setConv(r.conversation);
      await refreshListas();
    });

  const viralMudou = (v: ViralDTO) => {
    void (async () => {
      setVirais((l) => (l ?? []).map((x) => (x.id === v.id ? v : x)));
      if (conv) await abrir(conv.id);
    })();
  };

  const emAndamento = ocupado || enviandoPedido || enviandoViral;

  return (
    <div className="min-h-screen bg-[#0a0a0b] pb-28 text-white">
      <Header aba={aba} gaveta={gaveta} avatares={avatares.length} onAba={mudarAba} onGaveta={setGaveta} />

      <main className="mx-auto max-w-[1600px] space-y-4 px-4 py-4 sm:px-6">
        <FlowBanner status={ponte} onOpen={() => setFlowAberto(true)} />

        {erro && (
          <div role="alert" className={`flex items-start justify-between gap-3 px-4 py-3 text-sm text-zinc-100 ${T.cartaoInterno}`}>
            <span>⚠ {erro}</span>
            <button type="button" onClick={() => setErro('')} aria-label="Fechar aviso" className="text-zinc-400 hover:text-white">
              ×
            </button>
          </div>
        )}

        {aba === 'diretor' && (
          <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:items-start lg:gap-5">
            <ConversationSidebar
              itens={convs}
              atual={conv?.id ?? ''}
              ocupado={emAndamento}
              onAbrir={(id) => void mutar(() => abrir(id))}
              onNova={() => void nova()}
              onRenomear={(id, t) => void renomear(id, t)}
              onApagar={(id) => void apagar(id)}
            />
            {conv ? (
              <DiretorPanel
                conv={conv}
                ocupado={emAndamento}
                enviandoViral={enviandoViral}
                enviandoPedido={enviandoPedido}
                onModo={(m) => void setModo(m)}
                onOpcoes={(p) => void setOpcoes(p)}
                onArquivoViral={(f) => void enviarViral(f)}
                onAbrirBiblioteca={() => setBibliotecaAberta(true)}
                onTirarViral={() => void patchConv({ viralId: null })}
                onViralMudou={viralMudou}
                onEnviar={enviarPedido}
                onConfirmarPlano={(id) => void confirmarPlano(id)}
                onCancelarPlano={(id) => void cancelarPlano(id)}
                onAbrirProducao={() => mudarAba('producao')}
                onNova={() => void nova()}
              />
            ) : (
              <p className={`p-6 text-sm ${T.textoFraco}`}>Carregando…</p>
            )}
          </div>
        )}
        {aba !== 'diretor' && (
          <div>
            <button type="button" onClick={() => mudarAba('diretor')} className={`rounded-full px-4 py-2 text-xs ${T.botaoSecundario}`}>
              🎬 Diretor
            </button>
          </div>
        )}
        {aba === 'manual' && (
          <ManualTab
            virais={virais ?? []}
            avatares={avatares}
            opcoes={conv?.options ?? null}
            onViralEnviado={() => void refreshListas()}
            onAbrirConfig={() => setGaveta('config')}
            onCriado={() => {
              void refreshListas();
              mudarAba('producao');
            }}
          />
        )}
        {aba === 'producao' && <ProducaoTab lotes={lotes} onMudou={() => void refreshListas()} onAbrirVideos={() => mudarAba('videos')} />}
        {aba === 'analisados' && <AnalisadosTab virais={virais} onAtualizar={() => void refreshListas()} onUsar={(v) => void usarViral(v)} />}
        {aba === 'videos' && <VideosTab tick={tick} />}
      </main>

      <HelpButtons />
      <BridgePill status={ponte} onClick={() => setFlowAberto(true)} />
      <ContasPanels status={ponte} escolhida={contaEscolhida} onEscolher={escolherConta} onAtualizar={atualizarPonte} />

      {gaveta === 'avatares' && <AvataresDrawer avatares={avatares} onMudou={refreshAvatares} onClose={() => setGaveta(null)} />}
      {gaveta === 'config' && (
        <ConfigDrawer
          status={ponte}
          onClose={() => setGaveta(null)}
          onMudou={() => {
            void refreshLotes();
            void refreshSettings();
          }}
          onConectarFlow={() => {
            setGaveta(null);
            setFlowAberto(true);
          }}
        />
      )}
      {flowAberto && <FlowModal status={ponte} simulacao={simulacao} onDesligarSimulacao={desligarSimulacao} onRetry={atualizarPonte} onClose={() => setFlowAberto(false)} />}
      {bibliotecaAberta && <ViralPicker virais={virais ?? []} atualId={conv?.viral?.id ?? null} onUsar={(v) => void usarViral(v)} onClose={() => setBibliotecaAberta(false)} />}
    </div>
  );
}

