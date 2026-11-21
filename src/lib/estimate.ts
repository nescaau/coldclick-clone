/**
 * Estimativa de gerações de um trabalho.
 *
 * Cada variação gera 1 imagem-base (a partir do avatar) e 1 vídeo (imagem → vídeo).
 * Como gerações podem falhar e precisam ser refeitas, o teto ("até N gerações")
 * inclui uma folga para novas tentativas:
 *
 *   folga = ceil(base * RETRY_RATIO) + RETRY_FIXED
 *
 * Calibrada para reproduzir o exemplo da referência: 20 variações →
 * 20 vídeos + 20 imagens-base = 40, folga = 20 + 2 = 22, total "até 62 gerações".
 * Se a plataforma original usar outra fórmula, basta ajustar as duas constantes.
 */
export const RETRY_RATIO = 0.5;
export const RETRY_FIXED = 2;

/** Tentativas máximas por item (1ª tentativa + reexecuções automáticas). */
export const MAX_ATTEMPTS_PER_ITEM = 3;

export interface GenerationEstimate {
  videos: number;
  baseImages: number;
  retryAllowance: number;
  /** Teto de gerações (base + folga de novas tentativas). */
  maxGenerations: number;
  label: string;
}

export function estimateGenerations(variations: number): GenerationEstimate {
  const n = Math.max(0, Math.floor(variations));
  const base = n * 2;
  const retryAllowance = Math.ceil(base * RETRY_RATIO) + RETRY_FIXED;
  const maxGenerations = base + retryAllowance;
  const videosLabel = `${n} ${n === 1 ? 'vídeo' : 'vídeos'}`;
  const imagesLabel = `${n} ${n === 1 ? 'imagem-base' : 'imagens-base'}`;
  return {
    videos: n,
    baseImages: n,
    retryAllowance,
    maxGenerations,
    label: `até ${maxGenerations} gerações: ${videosLabel} e ${imagesLabel}`,
  };
}
