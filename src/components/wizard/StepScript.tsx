'use client';

import { Mic } from 'lucide-react';
import { useState } from 'react';
import { LANGUAGES, type LanguageId } from '@/lib/catalog';
import { apiFetch, errorMessage, jsonInit } from '@/lib/client';
import { ROUTES } from '@/lib/nav';
import type { VideoDTO } from '@/lib/types';
import { Alert, Button, Field, LinkButton } from '../ui';
import type { WizardState } from './state';

interface Props {
  state: WizardState;
  whisperConfigured: boolean;
  onChange: (patch: Partial<WizardState>) => void;
  onVideoUpdate: (video: VideoDTO) => void;
}

/**
 * Etapa 2 · Roteiro ("Fala e idioma"): idioma + copy. A copy pode vir da transcrição do vídeo
 * (Whisper) — que o usuário pode editar — ou ser escrita à mão.
 */
export function StepScript({ state, whisperConfigured, onChange, onVideoUpdate }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const video = state.video!;

  const transcribe = async () => {
    setLoading(true);
    setError(null);
    try {
      const { text } = await apiFetch<{ text: string }>(`/api/videos/${video.id}/transcribe`, jsonInit('POST', { language: state.language }));
      onChange({ transcript: text, transcriptSource: 'whisper', copyText: text });
      onVideoUpdate({ ...video, transcript: text, transcriptLanguage: state.language });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Idioma do roteiro" hint="Usado na transcrição e na geração das falas.">
          <select className="field" value={state.language} onChange={(e) => onChange({ language: e.target.value as LanguageId })}>
            {LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Copy</p>
            <p className="text-xs text-muted-foreground">O texto que o avatar deve falar. Transcreva a fala do vídeo ou escreva manualmente.</p>
          </div>
          <Button variant="primary" onClick={transcribe} loading={loading} disabled={!whisperConfigured}>
            <Mic /> {state.transcriptSource === 'whisper' ? 'Transcrever novamente' : 'Transcrever vídeo'}
          </Button>
        </div>

        {!whisperConfigured && (
          <Alert tone="warning">
            A chave da API de transcrição ainda não foi configurada. Escreva a copy manualmente ou{' '}
            <LinkButton href={ROUTES.studioSettings} variant="link" size="sm" className="inline-flex min-h-0 p-0 underline">
              abra as configurações do estúdio
            </LinkButton>
            .
          </Alert>
        )}
        {error && <Alert>{error}</Alert>}

        <textarea
          className="field min-h-48 resize-y"
          aria-label="Copy"
          placeholder="A transcrição aparecerá aqui depois que você iniciar; se preferir, escreva a copy manualmente."
          value={state.copyText}
          onChange={(e) => onChange({ copyText: e.target.value })}
        />
        {video.transcript && state.copyText !== video.transcript && (
          <Button variant="ghost" size="sm" onClick={() => onChange({ transcript: video.transcript!, transcriptSource: 'whisper', copyText: video.transcript! })}>
            Usar a transcrição salva deste vídeo
          </Button>
        )}
      </div>
    </div>
  );
}
