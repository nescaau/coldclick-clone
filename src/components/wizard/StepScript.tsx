'use client';

import { ChevronDown, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { MAX_COPY_CHARS, OUTPUT_LANGUAGES } from '@/lib/catalog';
import { apiFetch, errorMessage, jsonInit } from '@/lib/client';
import { speechSeconds, type Scene } from '@/lib/scenes';
import type { JobDetailDTO, VideoDTO } from '@/lib/types';
import { Alert, Button, ConfirmDialog, Segmented, useToast } from '../ui';
import { copyLength, type WizardState } from './state';

interface Props {
  state: WizardState;
  products: string[];
  /** O serviço de transcrição está configurado (chave de API). */
  transcriptionReady: boolean;
  onChange: (patch: Partial<WizardState>) => void;
  onVideoUpdate: (video: VideoDTO) => void;
}

interface TranscriptionResponse {
  job: JobDetailDTO;
  text: string;
  scenes: Scene[];
}

/** Etapa 2 · Roteiro e produto ("Fala e idioma"): produto, copy falada (transcrição em cenas) e idioma. */
export function StepScript({ state, products, transcriptionReady, onChange, onVideoUpdate }: Props) {
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const video = state.video!;
  const chars = copyLength(state);
  const hasScenes = state.scenes.length > 0;

  const transcribe = async () => {
    setConfirming(false);
    setRunning(true);
    setError(null);
    try {
      const res = await apiFetch<TranscriptionResponse>('/api/transcriptions', jsonInit('POST', { videoId: video.id }));
      onChange({ scenes: res.scenes, transcript: res.text, transcriptSource: 'whisper', copyText: '' });
      onVideoUpdate({ ...video, transcript: res.text, transcriptScenes: res.scenes });
      toast('Transcrição pronta e dividida por cena.');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRunning(false);
    }
  };

  const editScene = (index: number, text: string) =>
    onChange({ scenes: state.scenes.map((s) => (s.index === index ? { ...s, text } : s)), transcriptSource: state.transcriptSource === 'whisper' ? 'whisper' : 'manual' });

  const status = running
    ? 'Transcrevendo o vídeo e separando as falas em cenas…'
    : hasScenes
      ? `${state.scenes.length} ${state.scenes.length === 1 ? 'cena pronta' : 'cenas prontas'} para revisar. Cada fala fica abaixo de 8 segundos e reserva o fim do clipe para o corte.`
      : transcriptionReady
        ? 'Serviço de transcrição pronto. A transcrição só será enviada depois da sua confirmação.'
        : 'Serviço de transcrição não configurado. Escreva a copy manualmente ou configure a chave em Configurações do estúdio.';

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Roteiro e produto</p>
        <h3 className="mt-1 text-xl font-bold tracking-tight">Revise a transcrição</h3>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          Você decide quando transcrever. Ao concluir, o sistema separa a fala em cenas de até 8 segundos para você revisar.
        </p>
      </div>

      <div>
        <label htmlFor="product" className="mb-2 block text-sm font-semibold">
          Produto do catálogo (opcional)
        </label>
        <span className="relative block">
          <select id="product" className="field appearance-none pr-9" value={state.product ?? ''} onChange={(e) => onChange({ product: e.target.value || null })}>
            <option value="">Sem produto</option>
            {products.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        </span>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          A lista inclui apenas ofertas com AFID próprio em pelo menos um funil. A seleção envia somente o nome do produto ao trabalho.
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-semibold">Copy falada no vídeo</p>
          <p className="text-xs tabular-nums text-muted-foreground">
            {chars.toLocaleString('pt-BR')} / {MAX_COPY_CHARS.toLocaleString('pt-BR')}
          </p>
        </div>
        <p role="status" className="text-sm leading-6 text-muted-foreground">
          {status}
        </p>

        {!hasScenes && (
          <Button variant="primary" onClick={() => setConfirming(true)} disabled={running || !transcriptionReady}>
            {running ? <Loader2 className="animate-spin" /> : null}
            {running ? 'Transcrevendo e dividindo…' : 'Transcrever e dividir em cenas'}
          </Button>
        )}
        {error && <Alert>{error}</Alert>}

        {hasScenes ? (
          <div className="space-y-3">
            {state.scenes.map((s) => (
              <div key={s.index} className="rounded-2xl bg-inset p-4">
                <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                  <span className="font-semibold">Cena {s.index}</span>
                  <span className="text-xs text-muted-foreground">
                    {s.start}–{s.end} s · fala {speechSeconds(s)} s · clipe até 8 s
                  </span>
                </div>
                <textarea className="field min-h-20 resize-y" aria-label={`Copy da cena ${s.index}`} value={s.text} onChange={(e) => editScene(s.index, e.target.value)} />
              </div>
            ))}
          </div>
        ) : (
          <textarea
            className="field min-h-36 resize-y"
            name="source_transcript"
            aria-label="Copy falada no vídeo"
            placeholder="A transcrição aparecerá aqui depois que você iniciar; se preferir, escreva a copy manualmente."
            value={state.copyText}
            onChange={(e) => onChange({ copyText: e.target.value, transcriptSource: e.target.value.trim() ? 'manual' : 'none' })}
          />
        )}
      </div>

      <div>
        <p id="language-label" className="mb-2 text-sm font-semibold">
          Idioma do vídeo
        </p>
        <Segmented label="Idioma do vídeo" value={state.outputLanguage} options={OUTPUT_LANGUAGES} onChange={(outputLanguage) => onChange({ outputLanguage })} />
      </div>

      <ConfirmDialog
        open={confirming}
        title="Confirmar transcrição"
        cancelLabel="Voltar"
        confirmLabel="Enviar transcrição"
        onCancel={() => setConfirming(false)}
        onConfirm={transcribe}
      >
        <p>
          O vídeo <strong>{video.name}</strong> será enviado para transcrição e divisão automática das falas em cenas. Esta ação envia uma chamada ao serviço de transcrição configurado e pode gerar custo.
        </p>
        <p>A solicitação só será enviada depois de confirmar. Se o resultado ficar incerto, confira o histórico do serviço antes de tentar novamente.</p>
      </ConfirmDialog>
    </div>
  );
}
