'use client';

import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { PageLayout } from '../PageLayout';
import { apiFetch, errorMessage, jsonInit } from '@/lib/client';
import { MAX_GEMINI_KEYS } from '@/lib/limits';
import type { GeminiKeyDTO } from '@/lib/types';
import { Alert, Button, Card } from '../ui';

/** Linhas não vazias do campo — cada uma é uma chave. */
const countLines = (text: string) => text.split(/\r?\n/).filter((l) => l.trim()).length;

export function GeminiKeysPage({ initialKeys }: { initialKeys: GeminiKeyDTO[] }) {
  const [keys, setKeys] = useState(initialKeys);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = countLines(text);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ keys: GeminiKeyDTO[] }>('/api/gemini-keys', jsonInit('POST', { keys: text }));
      setKeys(res.keys);
      setText('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const mutate = async (url: string, init: RequestInit) => {
    setError(null);
    try {
      setKeys(await apiFetch<GeminiKeyDTO[]>(url, init));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <PageLayout>
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <h1 className="text-3xl font-bold leading-10 tracking-[-0.01em]">Chaves Gemini</h1>
          <p className="mt-2 text-sm text-muted-foreground">Conecte suas chaves do Gemini para gerar os prompts do Creative Studio pela sua própria conta.</p>
        </div>

        {error && <Alert>{error}</Alert>}

        <Card className="p-6" aria-label="Adicionar chaves">
          <h2 className="text-base font-semibold">Adicionar chaves</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Cole uma chave por linha. Você pode cadastrar até {MAX_GEMINI_KEYS}; o ColdClick mostrará somente os quatro últimos caracteres após salvar.
          </p>
          <form
            className="mt-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (ready > 0) void add();
            }}
          >
            <label htmlFor="gemini-keys" className="mb-1.5 block text-sm font-semibold">
              Chaves da API Gemini
            </label>
            <textarea
              id="gemini-keys"
              className="field min-h-28 resize-y font-mono"
              placeholder={'AIza…\nAIza…'}
              autoComplete="off"
              spellCheck={false}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              As chaves ficam criptografadas no banco e nunca são devolvidas à página. Depois de salvar, limpe o campo se o navegador mantiver o conteúdo preenchido.
            </p>
            <div className="mt-4 flex items-center justify-between gap-4">
              <p className="text-sm text-muted-foreground">
                {ready} {ready === 1 ? 'chave pronta' : 'chaves prontas'}
              </p>
              <Button type="submit" variant="primary" loading={busy} disabled={ready === 0}>
                Adicionar chave
              </Button>
            </div>
          </form>
        </Card>

        <Card className="p-6" aria-label="Ordem de tentativa">
          <div className="flex items-start justify-between gap-6">
            <div>
              <h2 className="text-base font-semibold">Ordem de tentativa</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Em uma nova geração, o sistema começa pela primeira chave e avança após uma rejeição confirmada. Na próxima geração, começa novamente pela primeira.
              </p>
            </div>
            <p className="shrink-0 whitespace-nowrap text-sm tabular-nums text-muted-foreground">
              {keys.length} / {MAX_GEMINI_KEYS}
            </p>
          </div>
          {keys.length > 0 && (
            <ol className="mt-5 space-y-2">
              {keys.map((k, i) => (
                <li key={k.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-sm font-semibold text-muted-foreground">{k.position}</span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">Chave {k.position}</p>
                      <p className="font-mono text-xs text-muted-foreground">{k.maskedKey}</p>
                      {k.lastError && <p className="mt-0.5 truncate text-xs text-destructive">{k.lastError}</p>}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center">
                    <Button variant="ghost" size="icon" className="size-9" aria-label={`Mover Chave ${k.position} para cima`} disabled={i === 0} onClick={() => mutate(`/api/gemini-keys/${k.id}`, jsonInit('PATCH', { move: 'up' }))}>
                      <ArrowUp />
                    </Button>
                    <Button variant="ghost" size="icon" className="size-9" aria-label={`Mover Chave ${k.position} para baixo`} disabled={i === keys.length - 1} onClick={() => mutate(`/api/gemini-keys/${k.id}`, jsonInit('PATCH', { move: 'down' }))}>
                      <ArrowDown />
                    </Button>
                    <Button
                      variant="destructive"
                      size="icon"
                      className="size-9"
                      aria-label={`Remover Chave ${k.position}`}
                      onClick={() => confirm(`Remover a Chave ${k.position}?`) && mutate(`/api/gemini-keys/${k.id}`, { method: 'DELETE' })}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <p className="text-xs leading-5 text-muted-foreground">
          Uma falha definitiva de autenticação, quota ou validação permite tentar a próxima chave. Se o Google não confirmar o resultado por timeout ou erro de rede, o ColdClick mantém o estado para consulta e não troca de chave automaticamente, evitando duplicar cobranças.
        </p>
      </div>
    </PageLayout>
  );
}
