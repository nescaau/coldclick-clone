import { DEFAULT_MODEL, isResolutionAllowed, type FormatId, type LanguageId, type ModelId, type ResolutionId } from '@/lib/catalog';
import type { TranscriptSource, VideoDTO } from '@/lib/types';

export interface WizardState {
  video: VideoDTO | null;
  /** Fala transcrita pelo Whisper (referência); a copy final é `copyText`. */
  transcript: string;
  transcriptSource: TranscriptSource;
  /** Copy usada na geração: a transcrição (editada) ou texto escrito à mão. */
  copyText: string;
  language: LanguageId;
  /** null = "Pessoa original" (mantém a pessoa do vídeo). */
  avatarId: string | null;
  format: FormatId;
  variations: number;
  model: ModelId;
  resolution: ResolutionId;
  title: string;
}

export const INITIAL_STATE: WizardState = {
  video: null,
  transcript: '',
  transcriptSource: 'none',
  copyText: '',
  language: 'pt',
  avatarId: null,
  format: '9:16',
  variations: 1,
  model: DEFAULT_MODEL,
  resolution: '720p',
  title: '',
};

/** Rótulos idênticos aos da referência. */
export const STEPS = [
  { id: 'video', label: 'Vídeo', hint: 'Referência' },
  { id: 'script', label: 'Roteiro', hint: 'Fala e idioma' },
  { id: 'personalize', label: 'Personalização', hint: 'Avatar e formato' },
  { id: 'review', label: 'Revisão', hint: 'Estimativa e envio' },
] as const;

export type StepId = (typeof STEPS)[number]['id'];

export interface FlowGate {
  /** Exige Chrome pareado e online para liberar a Revisão (REQUIRE_FLOW_CONNECTION). */
  required: boolean;
  connected: boolean;
}

/**
 * Pendência que impede de avançar a partir de cada etapa (mensagens da referência), ou null se ok.
 * A etapa "review" só diz respeito à conexão com o Flow.
 */
export function stepBlocker(step: StepId, s: WizardState, flow: FlowGate): string | null {
  switch (step) {
    case 'video':
      return s.video ? null : 'Escolha ou importe um vídeo de referência para continuar.';
    case 'script':
      return s.copyText.trim() ? null : 'Informe ou revise a fala do vídeo para continuar.';
    case 'personalize':
      return isResolutionAllowed(s.model, s.resolution) ? null : '360p só está disponível com Omni 1.1 Flash.';
    case 'review':
      return flow.required && !flow.connected ? 'Conecte a Executora do Flow e conclua a configuração antes de revisar.' : null;
  }
}

/** Primeira etapa (até `upTo`) que ainda tem pendência, ou -1 se todas as anteriores estão ok. */
export function firstBlockedIndex(upTo: number, s: WizardState, flow: FlowGate): number {
  for (let i = 0; i < upTo; i++) if (stepBlocker(STEPS[i].id, s, flow)) return i;
  return -1;
}
