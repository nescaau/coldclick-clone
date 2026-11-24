'use client';
import { useEffect, useState } from 'react';
import { apiDelete, apiGet, apiPatch, apiPut } from '@/lib/client';
import { MAX_QUANTITY, MAX_VIRAL_MB } from '@/lib/limits';
import { ROLETA_TOTAL } from '@/lib/domain/plan';
import {
  ALT_COLOR_LABEL,
  BRAIN_OPTIONS,
  IMAGE_MODEL_OPTIONS,
  PARALLEL_OPTIONS,
  SUBTITLE_COLORS,
  SUBTITLE_FONTS,
  SUBTITLE_POSITIONS,
  SUBTITLE_STYLES,
  SUBTITLE_WORDS,
} from '@/lib/domain/settings';
import { normalizeHex } from '@/lib/domain/video-options';
import { DEFAULT_SETTINGS, type SettingsDTO, type SubtitleSettings } from '@/lib/types';
import { Drawer, T } from './ui';

const Titulo = ({ children }: { children: string }) => <h3 className={`mb-2 ${T.rotulo}`}>{children}</h3>;
const Ajuda = ({ children }: { children: React.ReactNode }) => <p className={`text-xs ${T.textoFraco}`}>{children}</p>;
const selectCls = `rounded-xl px-3 py-2 text-sm ${T.campo} bg-[#0e0e10]`;

/** ⚙ CONFIGURAÇÃO (painel lateral). Tudo é preferência local em SQLite; sem Antigravity, sem login. */
export function ConfigDrawer({ onClose, onConectarFlow, onMudou }: { onClose: () => void; onConectarFlow: () => void; onMudou: () => void }) {
  const [s, setS] = useState<SettingsDTO>(DEFAULT_SETTINGS);
  const [pronto, setPronto] = useState(false);
  const [erro, setErro] = useState('');
  const [legenda, setLegenda] = useState<SubtitleSettings>(DEFAULT_SETTINGS.subtitle);
  const [chave, setChave] = useState('');
  const [msgChave, setMsgChave] = useState('');
  const [hex, setHex] = useState('');

  useEffect(() => {
    apiGet<SettingsDTO>('/settings')
      .then((r) => {
        setS(r);
        setLegenda(r.subtitle);
        setHex(r.subtitle.color);
        setPronto(true);
      })
      .catch((e) => setErro((e as Error).message));
  }, []);

  const salvar = async (patch: Record<string, unknown>) => {
    setErro('');
    try {
      const r = await apiPatch<SettingsDTO>('/settings', patch);
      setS(r);
      onMudou();
    } catch (e) {
      setErro((e as Error).message);
    }
  };

  const mudaLegenda = (p: Partial<SubtitleSettings>) => setLegenda((l) => ({ ...l, ...p, saved: false }));
  const ativoCor = (hexCor: string) => !legenda.alternate && legenda.color.toUpperCase() === hexCor;
  const palavras = legenda.alternate ? ['a', 'legenda', 'fica', 'assim'] : null;

  return (
    <Drawer titulo="CONFIGURAÇÃO" onClose={onClose}>
      {erro && (
        <p role="alert" className="rounded-xl border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs text-white">
          ⚠ {erro}
        </p>
      )}

      <section aria-label="Conexões">
        <Titulo>CONEXÕES</Titulo>
        <div className="space-y-2">
          <div className={`flex items-center gap-3 p-3 ${T.cartaoInterno}`}>
            <span title="conectado" className="text-emerald-400">
              ●
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-black text-white">Zerum local</p>
              <p className={`text-xs ${T.textoFraco}`}>sem login · sem assinatura · sem Antigravity</p>
            </div>
          </div>
          <div className={`space-y-2 p-3 ${T.cartaoInterno}`}>
            <div className="flex items-center gap-3">
              <span title="não conectado">○</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-black text-white">Conta do Flow</p>
                <p className={`text-xs ${T.textoFraco}`}>não conectada</p>
              </div>
              <button type="button" onClick={onConectarFlow} className={`rounded-xl px-4 py-1.5 text-sm ${T.botaoClaro}`}>
                Conectar
              </button>
            </div>
            <Ajuda>
              Caiu sozinha? Chrome → Desempenho → "Manter sempre ativo": <b className="text-zinc-200">flow.google.com</b>.
            </Ajuda>
          </div>
        </div>
      </section>

      <section aria-label="Geração" className="space-y-3">
        <Titulo>GERAÇÃO</Titulo>
        <label className="flex items-center justify-between gap-3 text-sm text-white">
          Vídeos simultâneos
          <select aria-label="Vídeos simultâneos" value={s.parallel} disabled={!pronto} onChange={(e) => void salvar({ parallel: Number(e.target.value) })} className={`w-40 ${selectCls}`}>
            {PARALLEL_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <Ajuda>Quantos vídeos o Zerum faz ao mesmo tempo.</Ajuda>
        {s.parallel > 2 && (
          <p className="text-xs text-white">
            <span aria-hidden="true">⚠</span> Mais de 2 vídeos ao mesmo tempo na mesma conta pode fazer o Google recusar vídeos dela por atividade incomum (o Zerum testa de novo sozinho).
          </p>
        )}
        <label className="flex items-center justify-between gap-3 text-sm text-white">
          Imagem
          <select aria-label="Imagem" value={s.imageModel} disabled={!pronto} onChange={(e) => void salvar({ imageModel: e.target.value })} className={`w-40 ${selectCls}`}>
            {IMAGE_MODEL_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <Ajuda>Melhor rosto. Se o modelo bater o limite do dia, o Zerum troca sozinho pro próximo.</Ajuda>
        <Ajuda>Modelo de vídeo: escolhido por conta, em Conexões → Contas que geram vídeo (todos os modelos de cada conta, com o custo).</Ajuda>
        <label className="flex items-start gap-2 text-xs text-white">
          <input type="checkbox" checked={s.flowCopy} onChange={(e) => void salvar({ flowCopy: e.target.checked })} className="mt-0.5" />
          Guardar também uma cópia no projeto do Flow (vídeos até 30 s)
        </label>

        <div className={`space-y-2 p-3 ${T.cartaoInterno}`}>
          <label className="flex items-start gap-2 text-sm font-bold text-white">
            <input type="checkbox" aria-label="Simulação local da geração" checked={s.simulation} onChange={(e) => void salvar({ simulation: e.target.checked })} className="mt-1" />
            Simulação local da geração
          </label>
          <Ajuda>
            Ligada: as cenas avançam pelo relógio e o vídeo “pronto” é uma cópia do viral (ou um clipe de teste) — serve para testar todo o fluxo sem gerar nada de verdade. Desligada: os lotes ficam na fila esperando o executor do Flow (fase futura).
          </Ajuda>
          <label className="flex items-center justify-between gap-3 text-xs text-white">
            Teste de falha: todo N-ésimo vídeo falha (0 = nunca)
            <input
              type="number"
              min={0}
              max={20}
              aria-label="Teste de falha"
              value={s.simFailEvery}
              onChange={(e) => void salvar({ simFailEvery: Math.max(0, Math.min(20, Number(e.target.value) || 0)) })}
              className={`w-20 px-2 py-1 text-sm ${T.campo}`}
            />
          </label>
        </div>
      </section>

      <section aria-label="Legenda" className="space-y-3">
        <Titulo>LEGENDA</Titulo>
        <div className={`space-y-3 p-3 ${T.cartaoInterno}`}>
          <p className="text-xs text-white">
            A legenda falada de <b>todo vídeo novo</b> (Diretor e Manual) sai no padrão do Zerum: 3 palavras por vez, embaixo, como sempre. Escolha só a <b>cor da palavra em destaque</b>; o resto já está certo.
          </p>
          <div className="flex gap-3">
            <div
              aria-label="prévia da legenda"
              className="flex h-36 w-20 shrink-0 items-end justify-center rounded-xl border border-white/10 bg-gradient-to-b from-zinc-900 to-black p-1 pb-3 text-center text-[10px] font-black leading-tight"
              style={{ fontFamily: `'${legenda.font}', system-ui, sans-serif`, fontSize: `${Math.round(10 * (legenda.size / 100))}px` }}
            >
              <span>
                <span>a</span>{' '}
                <span style={{ color: palavras ? '#FFFFFF' : legenda.color }}>legenda</span>{' '}
                <span style={{ color: palavras ? '#FFFF00' : undefined }}>fica</span> <span>assim</span>
              </span>
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <p className={`text-[11px] ${T.textoFraco}`}>Cor da palavra em destaque</p>
              <div className="flex flex-wrap gap-1.5">
                {SUBTITLE_COLORS.map((c) => (
                  <button
                    key={c.hex}
                    type="button"
                    aria-label={`Cor ${c.nome}`}
                    aria-pressed={ativoCor(c.hex)}
                    title={c.nome}
                    onClick={() => (mudaLegenda({ color: c.hex, alternate: false }), setHex(c.hex))}
                    className={`h-7 w-7 rounded-full border ${ativoCor(c.hex) ? 'scale-110 border-white ring-2 ring-white/70' : 'border-white/30'}`}
                    style={{ background: c.hex }}
                  />
                ))}
                <button
                  type="button"
                  aria-label={ALT_COLOR_LABEL}
                  aria-pressed={legenda.alternate}
                  title={ALT_COLOR_LABEL}
                  onClick={() => mudaLegenda({ alternate: true })}
                  className={`h-7 w-7 rounded-full border ${legenda.alternate ? 'scale-110 border-white ring-2 ring-white/70' : 'border-white/30'}`}
                  style={{ background: 'conic-gradient(#fff 0 50%, #FFFF00 50% 100%)' }}
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label="Cor livre da palavra em destaque"
                  value={legenda.color.toLowerCase()}
                  onChange={(e) => (mudaLegenda({ color: normalizeHex(e.target.value) ?? legenda.color, alternate: false }), setHex(e.target.value.toUpperCase()))}
                  className="h-7 w-7 rounded-md"
                />
                <input
                  aria-label="Cor da palavra em destaque em hex"
                  value={hex}
                  maxLength={7}
                  placeholder="#FFFF00"
                  onChange={(e) => {
                    setHex(e.target.value);
                    const n = normalizeHex(e.target.value);
                    if (n) mudaLegenda({ color: n, alternate: false });
                  }}
                  onBlur={() => setHex(legenda.color)}
                  className={`w-24 px-2 py-1 font-mono text-xs ${T.campo}`}
                />
              </div>
            </div>
          </div>

          <details className="rounded-xl border border-white/10 px-3 py-2">
            <summary className="cursor-pointer text-sm font-bold text-white">Ajustes avançados</summary>
            <div className="mt-2 space-y-2 text-xs text-white">
              <Ajuda>Só se você quiser fugir da legenda de sempre. Vale pra todo vídeo novo; dá pra mudar vídeo por vídeo em Editar.</Ajuda>
              <Grupo rotulo="Palavras por vez">
                {SUBTITLE_WORDS.map((n) => (
                  <Chip key={n} ativo={legenda.words === n} onClick={() => mudaLegenda({ words: n })}>
                    {n === 1 ? '1 palavra' : `${n} palavras`}
                  </Chip>
                ))}
              </Grupo>
              <Grupo rotulo="Estilo">
                {SUBTITLE_STYLES.map((n) => (
                  <Chip key={n} ativo={legenda.style === n} onClick={() => mudaLegenda({ style: n })}>
                    {n}
                  </Chip>
                ))}
              </Grupo>
              <Grupo rotulo="Posição">
                {SUBTITLE_POSITIONS.map((n) => (
                  <Chip key={n} ativo={legenda.position === n} onClick={() => mudaLegenda({ position: n })}>
                    {n}
                  </Chip>
                ))}
              </Grupo>
              <label className="flex items-center justify-between gap-2">
                altura da legenda
                <input type="number" min={0} max={100} aria-label="altura da legenda" value={legenda.height} onChange={(e) => mudaLegenda({ height: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} className={`w-20 px-2 py-1 ${T.campo}`} />
              </label>
              <label className="flex items-center justify-between gap-2">
                <span>
                  Tamanho · <span>{legenda.size}</span> %
                </span>
                <input type="number" min={50} max={200} aria-label="tamanho da legenda" value={legenda.size} onChange={(e) => mudaLegenda({ size: Math.max(50, Math.min(200, Number(e.target.value) || 100)) })} className={`w-20 px-2 py-1 ${T.campo}`} />
              </label>
              <Grupo rotulo="Fonte">
                {SUBTITLE_FONTS.map((n) => (
                  <Chip key={n} ativo={legenda.font === n} onClick={() => mudaLegenda({ font: n })}>
                    {n}
                  </Chip>
                ))}
              </Grupo>
            </div>
          </details>
        </div>
        <button type="button" onClick={() => void salvar({ subtitle: { ...legenda, saved: true } }).then(() => setLegenda((l) => ({ ...l, saved: true })))} className={`rounded-xl px-4 py-2 text-sm ${T.botaoVidro}`}>
          ★ Salvar como padrão
        </button>
        <Ajuda>
          {s.subtitle.saved
            ? 'Padrão salvo: todo vídeo novo sai com essa legenda. Mude e salve de novo quando quiser.'
            : 'Sem padrão salvo: todo vídeo novo sai na legenda de sempre. Escolha uma cor e salve pra valer em todos.'}
        </Ajuda>
      </section>

      <section aria-label="Aprovação">
        <Titulo>APROVAÇÃO</Titulo>
        <label className="flex items-start gap-2 text-sm text-white">
          <input type="checkbox" aria-label="Aprovar tudo automaticamente" checked={s.autoApprove} onChange={(e) => void salvar({ autoApprove: e.target.checked })} className="mt-1" />
          <span>
            <b>Aprovar tudo automaticamente</b>
            <span className={`mt-1 block text-xs ${T.textoFraco}`}>
              Ligado: o Zerum segue direto do pedido até o vídeo — plano, elenco e cenas passam sem clique (você acompanha em Produção). Desligado: você confere o plano e aprova o elenco.
            </span>
          </span>
        </label>
      </section>

      <section aria-label="Inteligência" className="space-y-2">
        <Titulo>INTELIGÊNCIA</Titulo>
        <select aria-label="Inteligência" value={s.brain} disabled={!pronto} onChange={(e) => void salvar({ brain: e.target.value })} className={`w-full ${selectCls}`}>
          {BRAIN_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        {/* Texto do clone (o do original fala de cota do Antigravity e de quem assiste o viral — não vale aqui). */}
        <Ajuda>Preferência guardada neste computador. Este clone não chama IA (o Diretor é local e sem Antigravity): a escolha só passa a valer quando existir um executor de IA — fase futura.</Ajuda>
      </section>

      <section aria-label="Seus limites" className="space-y-2">
        <Titulo>SEUS LIMITES</Titulo>
        <div className={`space-y-1 p-3 text-xs text-white ${T.cartaoInterno}`}>
          <p>VIRAL · MP4 até {MAX_VIRAL_MB} MB</p>
          <p>LOTE · até {MAX_QUANTITY} vídeos por pedido</p>
          <p>
            ROLETA · {s.roletaUsed} de {ROLETA_TOTAL} combinações usadas
          </p>
          <p className="pt-1 text-[10px] font-mono uppercase tracking-widest text-zinc-400">CRÉDITOS DO FLOW (POR CONTA)</p>
          <p className={T.textoFraco}>Nenhuma conta do Flow conectada pela extensão.</p>
          <p className={T.textoFraco}>Estimativa de vídeos: aparece depois do 1º vídeo pronto (medida real do seu gasto).</p>
        </div>
      </section>

      <section aria-label="Chave própria" className="space-y-2">
        <Titulo>DIRETOR (MODO ANTIGO, CHAVE PRÓPRIA)</Titulo>
        {s.apiKeyMasked ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-bold text-white">guardada · {s.apiKeyMasked}</span>
            <button
              type="button"
              onClick={() =>
                void apiDelete<SettingsDTO>('/settings/key')
                  .then((r) => (setS(r), setMsgChave('Chave apagada.')))
                  .catch((e) => setMsgChave(`⚠ ${(e as Error).message}`))
              }
              className={`rounded-xl px-3 py-1.5 text-xs ${T.botaoVidro}`}
            >
              Apagar chave
            </button>
          </div>
        ) : (
          <>
            <Ajuda>Só pra quem ainda usa o modo antigo: cole a chave e clique em Salvar. Aqui ela só fica guardada neste computador — não é testada nem enviada a lugar nenhum.</Ajuda>
            <div className="flex gap-2">
              <input type="password" autoComplete="off" aria-label="Chave" value={chave} onChange={(e) => setChave(e.target.value)} className={`min-w-0 flex-1 px-3 py-2 text-sm ${T.campo}`} />
              <button
                type="button"
                disabled={chave.trim().length < 8}
                onClick={() =>
                  void apiPut<SettingsDTO>('/settings/key', { key: chave })
                    .then((r) => (setS(r), setChave(''), setMsgChave('')))
                    .catch((e) => setMsgChave(`⚠ ${(e as Error).message}`))
                }
                className={`rounded-xl px-4 py-2 text-sm ${T.botaoClaro}`}
              >
                Salvar
              </button>
            </div>
          </>
        )}
        {msgChave && (
          <p role="status" className="text-xs text-zinc-300">
            {msgChave}
          </p>
        )}
      </section>
    </Drawer>
  );
}

function Grupo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className={T.textoFraco}>{rotulo}</p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Chip({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={ativo} onClick={onClick} className={`rounded-full px-3 py-1 text-[11px] font-bold ${ativo ? T.pillAtiva : 'border border-white/15 text-zinc-300 hover:border-white/40'}`}>
      {children}
    </button>
  );
}
