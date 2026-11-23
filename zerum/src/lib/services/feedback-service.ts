import { insertFeedback } from '../repo/feedback';

/** "Sugestão ou bug": no original vai para o servidor da 001; aqui só é guardado neste banco (nada sai da máquina). */
export function sendFeedback(input: { kind: 'bug' | 'sugestao'; text: string }): { id: string } {
  return { id: insertFeedback(input) };
}
