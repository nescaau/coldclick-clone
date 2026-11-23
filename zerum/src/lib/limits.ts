/** Limites compartilhados entre servidor e interface (a UI exibe "MP4 até 60 MB"). */
export const MAX_VIRAL_MB = 60;
export const MAX_VIRAL_BYTES = MAX_VIRAL_MB * 1024 * 1024;

/** "Nome do lote": até 40 letras/números (texto literal do original). */
export const MAX_BATCH_NAME = 40;
/** Palavra do comentário (a palavra da automação do balão). */
export const MAX_WORD = 24;
/** Teto de vídeos por lote pedido ao Diretor. */
export const MAX_QUANTITY = 50;

export const MAX_MESSAGE_CHARS = 4000;
export const MAX_CONVERSATION_TITLE = 80;
export const MAX_AVATAR_NAME = 60;
export const MAX_AVATAR_DESCRIPTION = 600;
export const MAX_FEEDBACK_CHARS = 2000;
