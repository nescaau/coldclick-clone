/**
 * Etapas registradas de uma transcrição e o PESO de cada uma no percentual do trabalho.
 *
 * A referência mostra "Falhou · 35%" para transcrições que falharam depois do envio do áudio; os pesos
 * abaixo reproduzem isso: solicitada (5) + áudio preparado (15) + áudio enviado (15) = 35. Concluída = 100.
 * Uma única fonte da verdade: o serviço grava estes rótulos e o repositório soma os pesos por eles.
 */
export const TRANSCRIPTION_STEP_LABELS = {
  requested: 'Transcrição solicitada',
  audioPrepared: 'Áudio preparado para envio',
  sent: 'Áudio enviado ao serviço de transcrição',
  received: 'Transcrição recebida com tempos',
  split: 'Fala dividida em cenas',
} as const;

export const TRANSCRIPTION_STEP_WEIGHTS: Record<string, number> = {
  [TRANSCRIPTION_STEP_LABELS.requested]: 5,
  [TRANSCRIPTION_STEP_LABELS.audioPrepared]: 15,
  [TRANSCRIPTION_STEP_LABELS.sent]: 15,
  [TRANSCRIPTION_STEP_LABELS.received]: 55,
  [TRANSCRIPTION_STEP_LABELS.split]: 10,
};

/** Percentual (0–100) de uma transcrição a partir dos rótulos das etapas concluídas. */
export function transcriptionPercent(doneLabels: readonly string[]): number {
  const total = [...new Set(doneLabels)].reduce((sum, l) => sum + (TRANSCRIPTION_STEP_WEIGHTS[l] ?? 0), 0);
  return Math.min(100, total);
}
