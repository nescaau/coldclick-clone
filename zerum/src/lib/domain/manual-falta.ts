/**
 * "ℹ Falta: …" da aba Manual — textos literais do bundle original (minúsculas e travessão como lá).
 * Mostra UMA pendência por vez, na ordem palavra → viral → marcados.
 */
export function manualFaltas(i: { palavra: string; viral: { state: string } | null; novos: boolean; marcados: number }): string[] {
  const f: string[] = [];
  if (!i.palavra.trim()) f.push('Qual palavra o público vai comentar?');
  if (!i.viral) f.push('suba um viral e espere a leitura (passo 1)');
  else if (i.viral.state === 'preparando') f.push('o viral escolhido não foi lido — clique em "tentar ler de novo"');
  if (!i.novos && i.marcados === 0) f.push('marque quem aparece (passo 3) — só os marcados entram no vídeo');
  return f;
}
