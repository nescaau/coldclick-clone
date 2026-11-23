'use client';
import { useEffect, useState } from 'react';
import type { BridgeStatus, PillMode } from '@/lib/bridge/status';
import { pillLabel } from '@/lib/bridge/status';
import { apiGet, apiPatch, apiPost } from '@/lib/client';
import { DEFAULT_SETTINGS, type SettingsDTO } from '@/lib/types';
import { Modal, T } from './ui';

/** Modo da pílula: texto pedido pelo dono ("sem Flow · clique pra reconectar"). 'contas' = variante "○ Contas Flow" do original. */
export const PILL_MODE: PillMode = 'reconectar';

/** Pílula de ponte (canto inferior esquerdo, monoespaçado maiúsculo). */
export function BridgePill({ status, onClick }: { status: BridgeStatus | null; onClick: () => void }) {
  const s = status ?? { ready: false, pending: 0 };
  return (
    <button id="ponte" type="button" className={s.ready ? 'ok' : ''} title="estado da ligação com o Flow" onClick={onClick}>
      {pillLabel(s, PILL_MODE)}
    </button>
  );
}

/** Botões flutuantes: "Precisando de ajuda?" e "💬 Sugestão ou bug". */
export function HelpButtons() {
  const [ajuda, setAjuda] = useState(false);
  const [feedback, setFeedback] = useState(false);
  return (
    <>
      <div className="fixed bottom-12 left-3 z-[60] flex flex-col gap-3">
        <button
          type="button"
          onClick={() => setAjuda(true)}
          className="group flex items-center gap-2"
          aria-label="Precisando de ajuda?"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black text-lg font-black ring-2 ring-white/70 shadow-[0_0_14px_rgba(255,255,255,.35)]" aria-hidden="true">
            Z
          </span>
          <span className="hidden rounded-full bg-black/80 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-zinc-200 group-hover:inline group-focus:inline">
            Precisando de ajuda?
          </span>
        </button>
        <button
          type="button"
          onClick={() => setFeedback(true)}
          className="group flex items-center gap-2"
          aria-label="Sugestão ou bug"
          title="Encontrou um erro? Tem uma ideia? Conta pra gente."
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-full border border-white/30 bg-black/70 text-lg" aria-hidden="true">
            💬
          </span>
          <span className="hidden rounded-full bg-black/80 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-zinc-200 group-hover:inline group-focus:inline">
            Sugestão ou bug
          </span>
        </button>
      </div>
      {ajuda && <AjudaModal onClose={() => setAjuda(false)} />}
      {feedback && <FeedbackModal onClose={() => setFeedback(false)} />}
    </>
  );
}

function AjudaModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal titulo="Precisando de ajuda?" onClose={onClose} largura="max-w-lg">
      <ol className={`list-decimal space-y-2 pl-5 text-sm ${T.textoSuave}`}>
        <li>No <b className="text-white">Diretor</b>, arraste um viral (MP4 até 60 MB) ou troque para “A partir da sua ideia”.</li>
        <li>Ajuste as <b className="text-white">Opções do vídeo</b> (palavra, nome do lote, balão, cor) e o idioma.</li>
        <li>Escreva o pedido e aperte Enter: o lote aparece em <b className="text-white">Produção</b> como “preparando”.</li>
        <li>A geração real (Flow, pela extensão) é a próxima fase — por enquanto nada é gerado nem enviado a lugar nenhum.</li>
      </ol>
    </Modal>
  );
}

function FeedbackModal({ onClose }: { onClose: () => void }) {
  const [kind, setKind] = useState<'bug' | 'sugestao'>('bug');
  const [texto, setTexto] = useState('');
  const [msg, setMsg] = useState('');
  const [enviando, setEnviando] = useState(false);

  const enviar = async () => {
    setEnviando(true);
    setMsg('');
    try {
      await apiPost('/feedback', { kind, text: texto });
      setMsg('Guardado neste computador. Obrigado!');
      setTexto('');
    } catch (e) {
      setMsg(`⚠ ${(e as Error).message}`);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Modal titulo="Sugestão ou bug" onClose={onClose} largura="max-w-lg">
      <div className="space-y-3">
        <div className="flex gap-2" role="radiogroup" aria-label="Tipo">
          {(['bug', 'sugestao'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => setKind(k)}
              className={`rounded-full px-4 py-1.5 text-xs font-bold ${kind === k ? T.pillAtiva : 'border border-white/15 text-zinc-400'}`}
            >
              {k === 'bug' ? 'Bug' : 'Sugestão'}
            </button>
          ))}
        </div>
        <textarea
          aria-label="Descrição"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Encontrou um erro? Tem uma ideia? Conta pra gente."
          className={`h-28 w-full p-3 text-sm ${T.campo}`}
        />
        {msg && <p className="text-xs text-zinc-300">{msg}</p>}
        <button type="button" onClick={enviar} disabled={enviando || texto.trim().length < 3} className={`rounded-xl px-5 py-2 text-sm ${T.botaoPrimario}`}>
          Enviar
        </button>
        <p className={`text-[11px] ${T.textoMudo}`}>No clone o recado só é guardado no banco local (zerum.db).</p>
      </div>
    </Modal>
  );
}

/** Painéis fixos no canto inferior direito: "Instalar extensão Zerum" e "Contas Flow · candidata". */
export function ContasPanels({ onAtualizar }: { onAtualizar: () => Promise<void> }) {
  const [settings, setSettings] = useState<SettingsDTO>(DEFAULT_SETTINGS);
  const [status, setStatus] = useState('');

  useEffect(() => {
    apiGet<SettingsDTO>('/settings').then(setSettings).catch(() => undefined);
  }, []);

  const salvar = async (patch: Partial<SettingsDTO>) => {
    setSettings((s) => ({ ...s, ...patch }));
    try {
      setSettings(await apiPatch<SettingsDTO>('/settings', patch));
    } catch (e) {
      setStatus(`⚠ ${(e as Error).message}`);
    }
  };

  const cx = 'rounded-lg bg-[#111] p-2 text-xs text-white shadow-lg';
  return (
    <div className="fixed bottom-3 right-3 z-[60] flex w-[min(20rem,calc(100vw-1.5rem))] flex-col items-end gap-2">
      <details className={`${cx} w-full`}>
        <summary className="cursor-pointer">Contas Flow · candidata</summary>
        <div className="mt-2 space-y-2">
          <label className="block">
            Conta e projeto autorizados
            <select disabled aria-label="Conta e projeto autorizados" className="mt-1 w-full rounded-md border border-white/15 bg-black/50 px-2 py-1">
              <option>Nenhuma conta conectada</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={settings.autoSwitch} onChange={(e) => void salvar({ autoSwitch: e.target.checked })} />
            Troca automática de conta
          </label>
          <label className="block">
            Trocar abaixo de créditos
            <input
              type="number"
              min={0}
              aria-label="Trocar abaixo de créditos"
              value={settings.minCredits}
              onChange={(e) => void salvar({ minCredits: Math.max(0, Number(e.target.value) || 0) })}
              className="mt-1 w-full rounded-md border border-white/15 bg-black/50 px-2 py-1"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              className={`rounded-md px-2 py-1 ${T.botaoVidro}`}
              onClick={async () => {
                await onAtualizar();
                setStatus('Nenhuma conta: o executor do Flow é fase futura.');
              }}
            >
              Atualizar contas
            </button>
            <button type="button" disabled className={`rounded-md px-2 py-1 ${T.botaoVidro}`}>
              Usar conta selecionada
            </button>
          </div>
          <p role="status" className="min-h-4 text-zinc-400">
            {status}
          </p>
        </div>
      </details>
      <details className={`${cx} w-full`}>
        <summary className="cursor-pointer">Instalar extensão Zerum</summary>
        <p className="mt-2 text-zinc-300">A extensão do clone é a fase futura (ponte site ⇄ extensão já desenhada em lib/bridge). Nada para instalar agora.</p>
      </details>
    </div>
  );
}
