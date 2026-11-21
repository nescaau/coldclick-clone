import {
  CTA_PRESETS,
  DEFAULT_AXES,
  DEFAULT_MODEL,
  isResolutionAllowed,
  MAX_COPY_CHARS,
  type AxesChoice,
  type CreativeFormatId,
  type ImageModelId,
  type ModelId,
  type OutputLanguageId,
  type ResolutionId,
  type ScriptModeId,
} from '@/lib/catalog';
import { countWords } from '@/lib/format';
import type { Scene } from '@/lib/scenes';
import type { TranscriptSource, VideoDTO } from '@/lib/types';

export interface WizardState {
  video: VideoDTO | null;
  /** Produto do catálogo (opcional). */
  product: string | null;
  /** Fala transcrita (referência) e a origem dela. */
  transcript: string;
  transcriptSource: TranscriptSource;
  /** Cenas da transcrição (editáveis). Vazio = copy escrita à mão em `copyText`. */
  scenes: Scene[];
  copyText: string;
  outputLanguage: OutputLanguageId;
  /** Vazio = "Pessoa original". Cada avatar gera 1 saída. */
  avatarIds: string[];
  scriptMode: ScriptModeId;
  creativeFormat: CreativeFormatId;
  axes: AxesChoice;
  imageModel: ImageModelId;
  /** Opção do seletor de CTA; `ctaCustom` guarda o texto livre. */
  ctaChoice: (typeof CTA_PRESETS)[number]['id'] | 'custom';
  ctaCustom: string;
  model: ModelId;
  resolution: ResolutionId;
  title: string;
}

export const INITIAL_STATE: WizardState = {
  video: null,
  product: null,
  transcript: '',
  transcriptSource: 'none',
  scenes: [],
  copyText: '',
  outputLanguage: 'original',
  avatarIds: [],
  scriptMode: 'keep',
  creativeFormat: 'original-recipe',
  axes: DEFAULT_AXES,
  imageModel: 'nano-banana-2.1',
  ctaChoice: 'none',
  ctaCustom: '',
  model: DEFAULT_MODEL,
  resolution: '720p',
  title: '',
};

/** Texto da copy: as cenas (uma por parágrafo) ou o texto escrito à mão. */
export const fullCopy = (s: Pick<WizardState, 'scenes' | 'copyText'>): string =>
  s.scenes.length ? s.scenes.map((x) => x.text.trim()).join('\n\n') : s.copyText;

/** Caracteres da copy (soma do texto das cenas, sem separadores) — o contador "129 / 12.000". */
export const copyLength = (s: Pick<WizardState, 'scenes' | 'copyText'>): number =>
  s.scenes.length ? s.scenes.reduce((n, x) => n + x.text.length, 0) : s.copyText.length;

export const copyWords = (s: Pick<WizardState, 'scenes' | 'copyText'>): number => countWords(fullCopy(s));

/** Texto final do CTA ('' = sem CTA). */
export function ctaText(s: Pick<WizardState, 'ctaChoice' | 'ctaCustom'>): string {
  if (s.ctaChoice === 'custom') return s.ctaCustom.trim();
  return CTA_PRESETS.find((p) => p.id === s.ctaChoice)?.text ?? '';
}

/** Número de saídas: 1 por avatar (1 se for "Pessoa original"). */
export const outputsOf = (s: Pick<WizardState, 'avatarIds'>): number => Math.max(1, s.avatarIds.length);

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
      if (!fullCopy(s).trim()) return 'Informe ou revise a fala do vídeo para continuar.';
      if (copyLength(s) > MAX_COPY_CHARS) return `A copy passa de ${MAX_COPY_CHARS.toLocaleString('pt-BR')} caracteres.`;
      if (s.scenes.some((x) => !x.text.trim())) return 'Há uma cena sem fala. Preencha ou apague o texto da cena vazia.';
      return null;
    case 'personalize': {
      const missing = (Object.values(s.axes) as Array<{ mode: string; value: string }>).some((a) => a.mode !== 'original' && !a.value.trim());
      if (missing) return 'Complete as descrições das variações.';
      if (s.ctaChoice === 'custom' && !s.ctaCustom.trim()) return 'Digite a chamada para ação ou escolha outra opção.';
      return isResolutionAllowed(s.model, s.resolution) ? null : '360p só está disponível com Omni 1.1 Flash.';
    }
    case 'review':
      return flow.required && !flow.connected ? 'Conecte a Executora do Flow e conclua a configuração antes de revisar.' : null;
  }
}

/** Primeira etapa (até `upTo`) que ainda tem pendência, ou -1 se todas as anteriores estão ok. */
export function firstBlockedIndex(upTo: number, s: WizardState, flow: FlowGate): number {
  for (let i = 0; i < upTo; i++) if (stepBlocker(STEPS[i].id, s, flow)) return i;
  return -1;
}

/** Texto de apoio (aria-label) de uma etapa que ainda não pode ser aberta. */
export function lockedHint(step: StepId, flow: FlowGate): string | null {
  if (step === 'personalize') return 'Escolha um avatar válido e complete as descrições das variações.';
  if (step === 'review') return flow.required ? 'Conecte a Executora do Flow e conclua a configuração antes de revisar.' : 'Conclua a configuração antes de revisar.';
  return null;
}
