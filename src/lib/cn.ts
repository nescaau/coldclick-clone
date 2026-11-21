/** Junta classes CSS ignorando valores vazios. Módulo puro: pode ser usado em Server e Client Components. */
export const cn = (...parts: Array<string | false | null | undefined>): string => parts.filter(Boolean).join(' ');
