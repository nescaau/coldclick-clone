'use client';

import { Check } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { PageLayout, PageHeading } from '../PageLayout';
import { apiFetch, errorMessage, jsonInit } from '@/lib/client';
import { ROUTES } from '@/lib/nav';
import type { PublicSettingsDTO } from '@/lib/types';
import { Alert, Button, Card, Field } from '../ui';

/** Configurações do estúdio (extra desta réplica): transcrição, modelo dos prompts e pasta de armazenamento. */
export function SettingsForm({ initial }: { initial: PublicSettingsDTO }) {
  const [settings, setSettings] = useState(initial);
  const [baseUrl, setBaseUrl] = useState(initial.whisperBaseUrl);
  const [model, setModel] = useState(initial.whisperModel);
  const [apiKey, setApiKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [geminiModel, setGeminiModel] = useState(initial.geminiPromptModel);
  const [storageDir, setStorageDir] = useState(initial.storageDirIsDefault ? '' : initial.storageDir);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const next = await apiFetch<PublicSettingsDTO>(
        '/api/settings',
        jsonInit('PUT', {
          whisperBaseUrl: baseUrl,
          whisperModel: model,
          // undefined = não mexe na chave salva; string vazia = apaga.
          whisperApiKey: clearKey ? '' : apiKey.trim() || undefined,
          geminiPromptModel: geminiModel,
          storageDir,
        }),
      );
      setSettings(next);
      setApiKey('');
      setClearKey(false);
      setSaved(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageLayout>
      <div className="mx-auto max-w-4xl space-y-6">
        <PageHeading title="Configurações do estúdio" description="Transcrição (Whisper), modelo dos prompts e pasta de armazenamento." />
        {error && <Alert>{error}</Alert>}

        <Card className="space-y-4 p-6">
          <div>
            <h2 className="text-base font-semibold">Transcrição (Whisper)</h2>
            <p className="mt-1 text-sm text-muted-foreground">Qualquer serviço compatível com a API de transcrição da OpenAI funciona (OpenAI, Groq, servidor Whisper local…).</p>
          </div>
          <Field label="URL base da API" hint="Ex.: https://api.openai.com/v1 · https://api.groq.com/openai/v1 · http://localhost:8000/v1">
            <input className="field" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Modelo" hint="Ex.: whisper-1, whisper-large-v3">
              <input className="field" value={model} onChange={(e) => setModel(e.target.value)} />
            </Field>
            <Field label="Chave da API" hint={settings.whisperConfigured ? `Chave salva (${settings.whisperApiKeyMasked}). Deixe em branco para manter.` : 'Nenhuma chave salva.'}>
              <input className="field font-mono" type="password" autoComplete="off" placeholder={settings.whisperConfigured ? '••••••••' : 'sk-…'} value={apiKey} onChange={(e) => setApiKey(e.target.value)} disabled={clearKey} />
            </Field>
          </div>
          {settings.whisperConfigured && (
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={clearKey} onChange={(e) => setClearKey(e.target.checked)} />
              Remover a chave salva
            </label>
          )}
          <p className="text-xs text-muted-foreground">
            Dica: instale o <code className="rounded bg-secondary px-1 font-mono">ffmpeg</code> (no Mac: <code className="rounded bg-secondary px-1 font-mono">brew install ffmpeg</code>) para transcrever vídeos grandes — o app extrai só o áudio antes de enviar.
          </p>
        </Card>

        <Card className="space-y-4 p-6">
          <div>
            <h2 className="text-base font-semibold">Gemini (geração de prompts)</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {settings.geminiKeysCount} {settings.geminiKeysCount === 1 ? 'chave cadastrada' : 'chaves cadastradas'}.{' '}
              <Link href={ROUTES.geminiKeys} className="text-link underline">
                Gerenciar chaves Gemini
              </Link>
            </p>
          </div>
          <Field label="Modelo para gerar prompts">
            <input className="field" value={geminiModel} onChange={(e) => setGeminiModel(e.target.value)} />
          </Field>
        </Card>

        <Card className="space-y-4 p-6">
          <div>
            <h2 className="text-base font-semibold">Armazenamento</h2>
            <p className="mt-1 text-sm text-muted-foreground">Onde ficam os vídeos enviados, fotos de avatar e arquivos gerados.</p>
          </div>
          <Field
            label="Pasta de armazenamento"
            hint={
              <>
                Em uso: <code className="rounded bg-secondary px-1 font-mono">{settings.storageDir}</code>
                {settings.storageDirIsDefault && ' (padrão)'}. Deixe em branco para usar o padrão.
              </>
            }
          >
            <input className="field font-mono" placeholder="/Users/voce/ColdClick/arquivos" value={storageDir} onChange={(e) => setStorageDir(e.target.value)} />
          </Field>
          <Alert tone="warning">
            Trocar a pasta <strong>não move</strong> os arquivos existentes. Copie o conteúdo da pasta antiga para a nova antes de salvar, senão vídeos e fotos já enviados deixarão de aparecer.
          </Alert>
        </Card>

        <div className="flex items-center justify-end gap-3">
          {saved && (
            <span className="flex items-center gap-1.5 text-sm text-success">
              <Check className="size-4" /> Configurações salvas
            </span>
          )}
          <Button variant="primary" onClick={save} loading={saving}>
            Salvar configurações
          </Button>
        </div>
      </div>
    </PageLayout>
  );
}
