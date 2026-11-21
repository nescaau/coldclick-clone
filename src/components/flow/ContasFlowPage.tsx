'use client';

import {
  Activity,
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  Download,
  FlaskConical,
  Monitor,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Trash2,
  Unlink,
  Workflow,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { PageLayout } from '../PageLayout';
import { apiFetch, errorMessage, jsonInit, useInterval } from '@/lib/client';
import { FLOW_URL } from '@/lib/limits';
import { ROTATION_RULES, type RotationPlan } from '@/lib/rotation';
import type { AccountAvailability, AccountsOverviewDTO, BrowserDTO, ExtensionOverviewDTO, GoogleAccountDTO } from '@/lib/types';
import { Alert, Button, buttonClass, Card, cn, DateText, Pill, Switch, useToast } from '../ui';

const AVAILABILITY: Record<AccountAvailability, { label: string; tone: 'success' | 'warning' | 'destructive' | 'neutral' }> = {
  available: { label: 'Elegível', tone: 'success' },
  low_credits: { label: `Créditos abaixo de ${ROTATION_RULES.minCredits}`, tone: 'destructive' },
  cycle_exhausted: { label: 'Cota do ciclo esgotada', tone: 'warning' },
  disabled: { label: 'Fora da rotação', tone: 'neutral' },
};

const secondsLeft = (iso: string) => Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 1000));

interface Props {
  initialExtension: ExtensionOverviewDTO;
  initialAccounts: AccountsOverviewDTO;
}

export function ContasFlowPage({ initialExtension, initialAccounts }: Props) {
  const [ext, setExt] = useState(initialExtension);
  const [acc, setAcc] = useState(initialAccounts);
  const [error, setError] = useState<string | null>(null);

  const refreshExt = () => apiFetch<ExtensionOverviewDTO>('/api/extension/browsers').then(setExt);
  const refreshAcc = () => apiFetch<AccountsOverviewDTO>('/api/accounts').then(setAcc);
  // Mantém "online"/sessão do Flow atualizados sem recarregar a página.
  useInterval(() => void Promise.all([refreshExt(), refreshAcc()]).catch(() => undefined), 3000);

  return (
    <PageLayout
      action={
        <a href={FLOW_URL} target="_blank" rel="noreferrer" className={buttonClass('outline')}>
          Abrir Google Flow <ArrowUpRight />
        </a>
      }
      className="space-y-5"
    >
      {error && <Alert>{error}</Alert>}
      <ConnectionsOverview ext={ext} />
      <ChromeConnector ext={ext} onChange={setExt} onError={setError} />
      <FlowAccounts acc={acc} ext={ext} onChange={setAcc} onRefresh={() => void refreshAcc().catch((e) => setError(errorMessage(e)))} onError={setError} />
    </PageLayout>
  );
}

/* ------------------------------------------------------------------ */
/* 1. Duas conexões                                                    */
/* ------------------------------------------------------------------ */

function StatusTile({ icon, title, sub, ok, label }: { icon: ReactNode; title: string; sub: string; ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-inset p-4">
      <span className={cn('grid size-10 shrink-0 place-items-center rounded-lg', ok ? 'bg-success/[0.14] text-success' : 'bg-secondary text-muted-foreground')}>{icon}</span>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground">{sub}</p>
      </div>
      <Pill tone={ok ? 'success' : 'neutral'}>
        <CheckCircle2 className="size-3.5" />
        {label}
      </Pill>
    </div>
  );
}

function ConnectionsOverview({ ext }: { ext: ExtensionOverviewDTO }) {
  const paired = ext.browsers.length;
  return (
    <Card className="p-6" aria-label="Duas conexões, funções diferentes">
      <p className="eyebrow">Configuração do gerador</p>
      <h2 className="text-2xl font-bold leading-8 tracking-tight">Duas conexões, funções diferentes</h2>
      <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
        O Chrome pareado mantém o Conector ativo. A sessão do Google Flow recebe as gerações. Acompanhe cada estado separadamente.
      </p>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <StatusTile
          icon={<Monitor className="size-5" />}
          title="Chrome Conector"
          sub={`${paired} ${paired === 1 ? 'Chrome pareado' : 'Chromes pareados'} · ${ext.onlineCount} online no ColdClick.`}
          ok={ext.onlineCount > 0}
          label={`${ext.onlineCount} online`}
        />
        <StatusTile
          icon={<Workflow className="size-5" />}
          title="Sessão Google Flow"
          sub={ext.flowSessionActive ? 'A ponte entre o Flow e o ColdClick está ativa.' : 'Abra o Flow em um Chrome pareado para ativar a ponte.'}
          ok={ext.flowSessionActive}
          label={ext.flowSessionActive ? 'Conectada' : 'Desconectada'}
        />
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* 2. Conector do Chrome                                               */
/* ------------------------------------------------------------------ */

const Code = ({ children }: { children: ReactNode }) => <code className="rounded bg-secondary px-1 font-mono text-xs text-foreground">{children}</code>;

function ChromeConnector({ ext, onChange, onError }: { ext: ExtensionOverviewDTO; onChange: (e: ExtensionOverviewDTO) => void; onError: (m: string | null) => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(true);
  const [browserName, setBrowserName] = useState('Chrome deste dispositivo');
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  /** Resultado do último teste: `ms` = ida e volta confirmada; `message` = motivo de não ter validado. */
  const [lastTest, setLastTest] = useState<{ ms: number } | { message: string } | null>(null);
  const connected = ext.onlineCount > 0;

  const createCode = async () => {
    setBusy(true);
    onError(null);
    try {
      onChange(await apiFetch<ExtensionOverviewDTO>('/api/extension/pairing', jsonInit('POST', { browserName })));
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (b: BrowserDTO) => {
    if (!confirm(`Revogar o pareamento de "${b.name}"? A extensão deixará de receber tarefas.`)) return;
    try {
      onChange(await apiFetch<ExtensionOverviewDTO>(`/api/extension/browsers/${b.id}`, { method: 'DELETE' }));
    } catch (e) {
      onError(errorMessage(e));
    }
  };

  /**
   * Valida o enlace sem gerar nada. O "eco" é a ida e volta ao estúdio (consulta do estado da ponte): mede o
   * tempo real da chamada; não dispara nenhuma operação de geração.
   */
  const testConnection = async () => {
    setTesting(true);
    onError(null);
    try {
      const started = performance.now();
      const fresh = await apiFetch<ExtensionOverviewDTO>('/api/extension/browsers');
      const ms = Math.max(1, Math.round(performance.now() - started));
      onChange(fresh);
      if (fresh.onlineCount === 0) {
        setLastTest({ message: 'Nenhum Chrome online. Abra o Chrome com a extensão pareada e tente de novo.' });
        toast('Nenhum Chrome online no momento.');
        return;
      }
      if (!fresh.flowSessionActive) {
        setLastTest({ message: 'A sessão do Google Flow não está ativa. Abra o Flow em um Chrome pareado e tente de novo.' });
        toast('A sessão do Google Flow não está ativa.');
        return;
      }
      setLastTest({ ms });
      toast(`Ponte Flow validada em ${ms} ms. Nenhuma geração ou crédito foi usado.`);
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card className="p-6" aria-label="Conector do Chrome">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Conector do Chrome</h2>
          <p className="mt-1 text-sm text-muted-foreground">Pareamento e conexão do Flow são etapas diferentes. Configure aqui somente se for usar uma geração real.</p>
        </div>
        <div className="flex items-center gap-2">
          <Pill tone={connected ? 'success' : 'neutral'}>{connected ? 'Conectada' : 'Desconectada'}</Pill>
          <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            Detalhes da conexão <ChevronDown className={cn('transition-transform', open && 'rotate-180')} />
          </Button>
        </div>
      </div>

      {open && (
        <div className="mt-5 space-y-5">
          <div className="space-y-3 px-1">
            <p className="text-sm font-semibold">Etapa 1 · Instale e abra a extensão</p>
            <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
              <li>Baixe a extensão e extraia o ZIP no computador.</li>
              <li>Use Chrome 116 ou superior para manter a conexão ativa em segundo plano.</li>
              <li>
                Abra <Code>chrome://extensions</Code>, ative o Modo do desenvolvedor e escolha <strong className="text-foreground">Carregar sem compactação</strong>; selecione a pasta extraída que contém{' '}
                <Code>manifest.json</Code>.
              </li>
              <li>Abra o popup ColdClick Conector para usar o código de pareamento desta tela.</li>
            </ol>
            <p className="text-xs leading-5 text-muted-foreground">
              No modo “Carregar sem compactação”, o Chrome não atualiza a extensão automaticamente. Depois que ela estiver publicada e instalada pela Chrome Web Store, as próximas versões serão atualizadas pelo próprio Chrome.
            </p>
            <a href="/api/extension/download" className={buttonClass('secondary', 'default', 'w-full rounded-xl bg-inset hover:bg-secondary')}>
              <Download /> Baixar extensão
            </a>
          </div>

          <div className="space-y-3 rounded-xl bg-inset p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Conexão com Google Flow</p>
                <p role="status" className="text-xs text-muted-foreground">
                  {lastTest && 'ms' in lastTest
                    ? `Ponte validada por eco em ${lastTest.ms} ms. Nenhuma geração foi iniciada nem crédito consumido.`
                    : connected
                      ? 'Extensão online. O teste não inicia geração nem consome crédito.'
                      : 'Pareie um Chrome para poder testar a conexão.'}
                </p>
              </div>
              <Button variant="secondary" loading={testing} onClick={testConnection}>
                <Activity /> Testar conexão sem gerar
              </Button>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              Para iniciar a Executora, abra a conta desejada em <strong className="text-foreground">Contas do Google Flow</strong> pelo botão “Abrir Flow”. Abrir o link compartilhado diretamente não vincula a aba à conta pareada e a ponte não será estabelecida. Quando o status indicar Flow ativo, use “Testar conexão sem gerar”; o teste não consome crédito.
            </p>
            {lastTest && (
              <p role="status" className="text-xs text-muted-foreground">
                {'ms' in lastTest ? `Último teste: ida e volta confirmada em ${lastTest.ms} ms; nenhuma operação de geração foi chamada.` : lastTest.message}
              </p>
            )}
          </div>

          <div className="grid gap-8 md:grid-cols-2">
            <section aria-label="Etapa 2 · Parear navegador" className="space-y-3">
              <h3 className="text-sm font-semibold">Etapa 2 · Parear navegador</h3>
              <p className="text-xs leading-5 text-muted-foreground">
                Gere um código de uso único, válido por 10 minutos. Abra o popup da extensão, cole o código e aceite o acesso ao domínio ColdClick.
              </p>
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold">Nome deste Chrome</span>
                <input className="field" value={browserName} maxLength={80} onChange={(e) => setBrowserName(e.target.value)} />
              </label>
              <Button variant="primary" onClick={createCode} loading={busy} disabled={!browserName.trim()}>
                Criar código de pareamento
              </Button>
              {ext.pairingCode && <PairingCodeBox code={ext.pairingCode.code} expiresAt={ext.pairingCode.expiresAt} />}
            </section>

            <section aria-label="Navegadores pareados" className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold">Navegadores pareados</h3>
                  <p className="text-xs text-muted-foreground">A disponibilidade é baseada no último sinal recebido.</p>
                </div>
                <Button variant="ghost" size="icon" className="size-8" aria-label="Atualizar navegadores pareados" onClick={() => void apiFetch<ExtensionOverviewDTO>('/api/extension/browsers').then(onChange).catch((e) => onError(errorMessage(e)))}>
                  <RefreshCw />
                </Button>
              </div>
              {ext.browsers.length === 0 ? (
                <p className="rounded-xl bg-inset px-4 py-6 text-center text-xs text-muted-foreground">Nenhum navegador pareado ainda.</p>
              ) : (
                <ul className="space-y-2">
                  {ext.browsers.map((b) => (
                    <li key={b.id} className="flex items-center gap-3 rounded-xl bg-inset p-3">
                      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/[0.14] text-link">
                        <Monitor className="size-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{b.name}</p>
                        <Pill tone={b.online ? 'success' : 'neutral'} className="mt-0.5">
                          {b.online && <CheckCircle2 className="size-3" />}
                          {b.online ? 'Online no ColdClick' : 'Offline'}
                        </Pill>
                        <p className="mt-0.5 text-xs text-muted-foreground">Última versão observada: {b.version ?? '—'}</p>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => revoke(b)}>
                        <Unlink /> Revogar
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}
    </Card>
  );
}

function PairingCodeBox({ code, expiresAt }: { code: string; expiresAt: string }) {
  const [left, setLeft] = useState(() => secondsLeft(expiresAt));
  useEffect(() => setLeft(secondsLeft(expiresAt)), [expiresAt]);
  useInterval(() => setLeft(secondsLeft(expiresAt)), 1000);
  if (left <= 0) return null;
  return (
    <div className="rounded-xl border border-primary/40 bg-primary/[0.08] p-4 text-center">
      <p className="text-xs text-muted-foreground">Código de pareamento</p>
      <p className="my-1 font-mono text-3xl font-bold tracking-[0.2em] text-link">{code}</p>
      <p className="text-xs text-muted-foreground">
        Expira em {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 3. Contas do Google Flow                                            */
/* ------------------------------------------------------------------ */

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="px-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-bold">{value}</p>
    </div>
  );
}

function FlowAccounts({ acc, ext, onChange, onRefresh, onError }: { acc: AccountsOverviewDTO; ext: ExtensionOverviewDTO; onChange: (a: AccountsOverviewDTO) => void; onRefresh: () => void; onError: (m: string | null) => void }) {
  const [rulesOpen, setRulesOpen] = useState(false);
  const run = async (url: string, init: RequestInit) => {
    onError(null);
    try {
      onChange(await apiFetch<AccountsOverviewDTO>(url, init));
    } catch (e) {
      onError(errorMessage(e));
    }
  };
  const patch = (id: string, data: object) => run(`/api/accounts/${id}`, jsonInit('PATCH', data));

  return (
    <Card className="p-6" aria-label="Contas do Google Flow">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Contas do Google Flow</h2>
          <p className="mt-1 text-sm text-muted-foreground">Veja saldo e disponibilidade, abra uma sessão ou pause uma conta. A ordem define qual conta será usada primeiro.</p>
        </div>
        <Button variant="ghost" aria-label="Atualizar contas Flow" onClick={onRefresh}>
          <RefreshCw /> Atualizar
        </Button>
      </div>

      <div className="mt-6 grid grid-cols-3 rounded-xl bg-inset py-4">
        <Stat label="Contas" value={acc.total} />
        <Stat label="Elegíveis" value={acc.eligible} />
        <Stat label="Sessões abertas" value={acc.openSessions} />
      </div>

      <div className="mt-3 rounded-xl bg-inset">
        <button type="button" aria-expanded={rulesOpen} onClick={() => setRulesOpen((v) => !v)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
          <SlidersHorizontal className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Regras de rotação</span>
            <span className="block text-xs text-muted-foreground">
              Troca automática ativa · mínimo {ROTATION_RULES.minCredits} créditos · até {ROTATION_RULES.maxVideosPerCycle} vídeos e {ROTATION_RULES.maxImagesPerCycle} imagens por conta
            </span>
          </span>
          <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', rulesOpen && 'rotate-180')} />
        </button>
        {rulesOpen && <RotationRules acc={acc} onChange={onChange} onError={onError} />}
      </div>

      <ol aria-label="Contas Flow por prioridade" className="mt-4 space-y-4">
        {acc.accounts.length === 0 && <li className="rounded-xl bg-inset px-4 py-8 text-center text-sm text-muted-foreground">Nenhuma conta cadastrada. Adicione a primeira abaixo.</li>}
        {acc.accounts.map((a, i) => (
          <AccountRow key={a.id} account={a} isFirst={i === 0} isLast={i === acc.accounts.length - 1} browsers={ext.browsers.length} onPatch={patch} onRemove={() => confirm(`Remover a conta ${a.email}?`) && run(`/api/accounts/${a.id}`, { method: 'DELETE' })} />
        ))}
      </ol>

      <AddAccount onAdded={onChange} onError={onError} />
    </Card>
  );
}

function AccountRow({ account: a, isFirst, isLast, browsers, onPatch, onRemove }: { account: GoogleAccountDTO; isFirst: boolean; isLast: boolean; browsers: number; onPatch: (id: string, data: object) => void; onRemove: () => void }) {
  const state = AVAILABILITY[a.availability];
  return (
    <li className="grid gap-4 rounded-xl bg-inset p-4 lg:grid-cols-[minmax(0,1fr)_220px]">
      <div className="min-w-0 space-y-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-bold">{a.name}</p>
            <Pill tone={state.tone}>{state.label}</Pill>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {a.email} · {a.tier}
          </p>
        </div>

        <ul aria-label={`Créditos de ${a.name}`} className="grid grid-cols-3 rounded-lg bg-card px-3 py-3">
          <li>
            <p className="text-xs text-muted-foreground">Saldo no Flow</p>
            <CreditsInput value={a.credits} onCommit={(credits) => onPatch(a.id, { credits })} />
          </li>
          <li>
            <p className="text-xs text-muted-foreground">Reservado</p>
            <p className="text-sm font-bold">{a.reservedCredits}</p>
          </li>
          <li>
            <p className="text-xs text-muted-foreground">Disponível</p>
            <p className="text-sm font-bold">{a.availableCredits}</p>
          </li>
        </ul>

        <p className="text-xs leading-5 text-muted-foreground">
          Saldo lido <DateText iso={a.creditsUpdatedAt} seconds /> · 0 créditos de gasto estimado · 0 vídeos em andamento · 0 imagens em andamento
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {a.sessionActive ? <Pill tone="success">Sessão Flow ativa</Pill> : <Pill>Sem sessão do Flow</Pill>}
          <span>
            {browsers} {browsers === 1 ? 'Chrome pareado' : 'Chromes pareados'}
          </span>
        </div>
      </div>

      <div className="space-y-2">
        {a.sessionActive ? (
          <Button variant="secondary" className="w-full" disabled>
            Sessão ativa
          </Button>
        ) : (
          <a href={FLOW_URL} target="_blank" rel="noreferrer" className={buttonClass('secondary', 'default', 'w-full')}>
            Abrir Flow
          </a>
        )}
        <div className="flex items-center justify-between rounded-lg bg-card px-3 py-2">
          <div>
            <p className="text-sm font-semibold">Usar na rotação</p>
            <p className="text-xs text-muted-foreground">{a.enabled ? 'Ativa' : 'Pausada'}</p>
          </div>
          <Switch checked={a.enabled} label={`Usar ${a.name} na rotação`} onChange={(enabled) => onPatch(a.id, { enabled })} />
        </div>
        <div className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
          <span className="mr-1">Prioridade {a.priority}</span>
          <Button variant="ghost" size="icon" className="size-8" aria-label={`Mover ${a.name} para cima`} disabled={isFirst} onClick={() => onPatch(a.id, { move: 'up' })}>
            <ArrowUp />
          </Button>
          <Button variant="ghost" size="icon" className="size-8" aria-label={`Mover ${a.name} para baixo`} disabled={isLast} onClick={() => onPatch(a.id, { move: 'down' })}>
            <ArrowDown />
          </Button>
          <Button variant="destructive" size="icon" className="size-8" aria-label={`Remover ${a.name}`} onClick={onRemove}>
            <Trash2 />
          </Button>
        </div>
      </div>
    </li>
  );
}

/** Saldo editável (fase 1: informado manualmente; fase 2: lido do Flow pela extensão). */
function CreditsInput({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Math.max(0, Math.floor(Number(text)));
    if (Number.isFinite(n) && n !== value) onCommit(n);
    else setText(String(value));
  };
  return (
    <input
      type="number"
      min={0}
      value={text}
      aria-label="Saldo no Flow"
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      className={cn('-ml-1 w-20 rounded bg-transparent px-1 text-sm font-bold tabular-nums outline-none hover:bg-secondary focus:bg-secondary', value < ROTATION_RULES.minCredits && 'text-destructive')}
    />
  );
}

function AddAccount({ onAdded, onError }: { onAdded: (a: AccountsOverviewDTO) => void; onError: (m: string | null) => void }) {
  const [email, setEmail] = useState('');
  const [label, setLabel] = useState('');
  const [credits, setCredits] = useState('');
  const [busy, setBusy] = useState(false);

  const add = async () => {
    setBusy(true);
    onError(null);
    try {
      onAdded(await apiFetch<AccountsOverviewDTO>('/api/accounts', jsonInit('POST', { email, label: label || undefined, credits: Number(credits) || 0 })));
      setEmail('');
      setLabel('');
      setCredits('');
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="mt-5 flex flex-wrap items-end gap-3 border-t border-border/40 pt-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (email.trim()) void add();
      }}
    >
      <label className="min-w-56 flex-1">
        <span className="mb-1.5 block text-xs text-muted-foreground">E-mail da conta Google</span>
        <input className="field" type="email" placeholder="conta@gmail.com" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="w-44">
        <span className="mb-1.5 block text-xs text-muted-foreground">Nome (opcional)</span>
        <input className="field" placeholder="shopbr018" value={label} onChange={(e) => setLabel(e.target.value)} />
      </label>
      <label className="w-32">
        <span className="mb-1.5 block text-xs text-muted-foreground">Saldo no Flow</span>
        <input className="field" type="number" min={0} placeholder="0" value={credits} onChange={(e) => setCredits(e.target.value)} />
      </label>
      <Button type="submit" variant="secondary" loading={busy} disabled={!email.trim()}>
        <Plus /> Adicionar conta
      </Button>
    </form>
  );
}

/** Conteúdo expandido de "Regras de rotação": ciclo atual, novo ciclo e simulador (dry-run). */
function RotationRules({ acc, onChange, onError }: { acc: AccountsOverviewDTO; onChange: (a: AccountsOverviewDTO) => void; onError: (m: string | null) => void }) {
  const [kind, setKind] = useState<'video' | 'image'>('video');
  const [count, setCount] = useState('10');
  const [plan, setPlan] = useState<RotationPlan | null>(null);
  const [busy, setBusy] = useState<'sim' | 'cycle' | null>(null);

  const simulate = async () => {
    setBusy('sim');
    onError(null);
    try {
      setPlan(await apiFetch<RotationPlan>('/api/rotation', jsonInit('POST', { action: 'preview', kind, count: Number(count) })));
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const newCycle = async () => {
    if (!confirm('Iniciar um novo ciclo? Os contadores de todas as contas serão zerados.')) return;
    setBusy('cycle');
    try {
      await apiFetch('/api/rotation', jsonInit('POST', { action: 'advance' }));
      onChange(await apiFetch<AccountsOverviewDTO>('/api/accounts'));
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const perAccount = plan?.steps.reduce<Record<string, number>>((m, s) => ({ ...m, [s.email]: (m[s.email] ?? 0) + 1 }), {});

  return (
    <div className="space-y-4 border-t border-border/40 px-4 py-4 text-sm text-muted-foreground">
      <ul className="list-disc space-y-1 pl-5">
        <li>A ordem de prioridade define a conta usada primeiro; quando ela esgota a cota, a próxima assume automaticamente.</li>
        <li>Conta com menos de {ROTATION_RULES.minCredits} créditos ou fora da rotação é ignorada.</li>
        <li>
          Cada conta atende até {ROTATION_RULES.maxVideosPerCycle} vídeos e {ROTATION_RULES.maxImagesPerCycle} imagens por ciclo; esgotadas as cotas, um novo ciclo começa.
        </li>
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p>
          <span className="font-semibold text-foreground">Ciclo #{acc.rotation.cycle}</span> · iniciado em <DateText iso={acc.rotation.cycleStartedAt} />
        </p>
        <Button variant="secondary" size="sm" loading={busy === 'cycle'} onClick={newCycle}>
          <RefreshCw /> Novo ciclo
        </Button>
      </div>
      <div className="space-y-3 rounded-lg bg-card p-4">
        <p className="flex items-center gap-2 font-semibold text-foreground">
          <FlaskConical className="size-4 text-link" /> Simular rotação
        </p>
        <p className="text-xs">Veja como N gerações seriam distribuídas entre as contas com o estado atual. Nada é gravado.</p>
        <div className="flex flex-wrap items-end gap-2">
          <select className="field w-36" value={kind} aria-label="Tipo de geração" onChange={(e) => setKind(e.target.value as 'video' | 'image')}>
            <option value="video">Vídeos</option>
            <option value="image">Imagens</option>
          </select>
          <input className="field w-28" type="number" min={1} max={200} aria-label="Quantidade" value={count} onChange={(e) => setCount(e.target.value)} />
          <Button variant="secondary" loading={busy === 'sim'} onClick={simulate}>
            Simular
          </Button>
        </div>
        {plan && perAccount && (
          <div className="space-y-2">
            {plan.shortfall > 0 && (
              <Alert tone="warning">
                {plan.shortfall} {plan.shortfall === 1 ? 'geração não poderia ser atendida' : 'gerações não poderiam ser atendidas'}: não há contas aptas (créditos ≥ {ROTATION_RULES.minCredits}).
              </Alert>
            )}
            <p className="text-xs">
              {plan.steps.length} atendidas em {plan.cyclesAdvanced + 1} {plan.cyclesAdvanced === 0 ? 'ciclo' : 'ciclos'}.
            </p>
            <ul className="grid gap-1 sm:grid-cols-2">
              {Object.entries(perAccount).map(([email, n]) => (
                <li key={email} className="flex justify-between rounded-md bg-inset px-3 py-1.5 text-xs">
                  <span className="truncate">{email}</span>
                  <span className="font-semibold tabular-nums text-foreground">{n}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
