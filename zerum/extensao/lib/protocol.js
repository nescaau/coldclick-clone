/**
 * Protocolo da ponte site ⇄ extensão — o lado da EXTENSÃO.
 *
 * Esta é uma implementação própria (reescrita), baseada na leitura do protocolo da extensão Zerum 0.4.18
 * (reference/zerum-001/extensao-0.4.18/): mesmas mensagens `zre`, mesmos estados e mesma política de cota.
 * O lado do SITE vive em src/lib/bridge/ (protocol.ts, broker.ts); o teste de contrato
 * (extensao/test/contract.test.mjs) compara os dois e falha se algum divergir.
 *
 * Nada aqui toca em rede nem em APIs do Chrome: são constantes e funções puras (rodam também no Node, nos testes).
 */

/** Versão do formato de mensagens/journal (muda só se o contrato quebrar). */
export const PROTOCOL = 'zerum-local-flow-v1';

/** Prazo do site para a extensão responder (a ponte do site rejeita com ERR_NO_RESPONSE; o pedido fica preservado). */
export const BRIDGE_TIMEOUT_MS = 25_000;

/** Texto literal do original: o pedido NÃO é reenviado sozinho — reconcilia-se, nunca se repete o submit. */
export const ERR_NO_RESPONSE = 'EXTENSAO_SEM_RESPOSTA; pedido preservado, não gerar outra vez';

/** Ações que o SITE pode pedir à extensão (a `connect` da 001 não existe aqui: não há login nem servidor). */
export const BRIDGE_ACTIONS = ['extensionStatus', 'accounts', 'enqueue', 'get', 'reconcile', 'download', 'job', 'beginAttempt', 'mediaState', 'recoverJob'];

/** Estados de uma ordem no broker. */
export const BROKER_STATES = ['queued', 'dispatched', 'accepted', 'completed', 'failed', 'unknown'];

/**
 * Transições permitidas. `unknown` só sai por reconciliação (leitura): vira completed/failed. NUNCA volta a
 * queued/dispatched — a reconciliação é uma releitura da MESMA operação, não uma nova geração.
 */
export const TRANSITIONS = {
  queued: ['dispatched', 'failed'],
  dispatched: ['accepted', 'failed', 'unknown'],
  accepted: ['completed', 'failed', 'unknown'],
  unknown: ['completed', 'failed'],
  completed: [],
  failed: [],
};

export const canTransition = (from, to) => (TRANSITIONS[from] ?? []).includes(to);
export const isTerminal = (state) => (TRANSITIONS[state] ?? ['x']).length === 0;
/** Só `queued` ainda não saiu para o Google: em qualquer outro estado reenviar o pedido é PROIBIDO. */
export const forbidsResubmit = (state) => state !== 'queued';

/** Comandos que o broker aceita (o mesmo conjunto do original). Esta extensão EXECUTA só `generate.video`. */
export const BROKER_COMMANDS = ['upload', 'save', 'generate.image', 'generate.video', 'generate.text', 'media.getBase64'];
export const EXECUTABLE_COMMANDS = ['generate.video'];
/** Comandos que alteram algo no Flow (gastam crédito/cota). `media.getBase64` só lê. */
export const isMutation = (cmd) => cmd !== 'media.getBase64';

// ─── cota ────────────────────────────────────────────────────────────────────────────────────────────────────────
/** 429/QUOTA/COTA pausam a conta por 24 h (conservador); INCOMUM/UNUSUAL/RESOURCE_EXHAUSTED por 5 min. */
export const QUOTA_PAUSE_MS = 24 * 60 * 60 * 1000;
export const SOFT_PAUSE_MS = 5 * 60 * 1000;

/** 'cota' (24 h) | 'incomum' (5 min) | null. A cota vence quando o texto tem as duas coisas. */
export function classifyRefusal(text) {
  const t = String(text ?? '');
  if (/QUOTA|COTA|(?<![0-9])429(?![0-9])/i.test(t)) return 'cota';
  if (/INCOMUM|UNUSUAL|RESOURCE_EXHAUSTED/i.test(t)) return 'incomum';
  return null;
}
export const pauseUntil = (kind, now = Date.now()) => now + (kind === 'cota' ? QUOTA_PAUSE_MS : SOFT_PAUSE_MS);

// ─── prazos do broker (iguais aos do original) ──────────────────────────────────────────────────────────────────
/** Uma conta está "online" se a aba do Flow bateu o coração nos últimos 90 s. */
export const PRESENCE_TTL_MS = 90_000;
/** `unknown` COM identificação da geração (aba/mídia) pode ser reconciliado por até 12 min. */
export const RECONCILE_TTL_MS = 12 * 60_000;
/** `unknown` SEM identificação não tem o que reconciliar: libera (como falha explícita) depois de 55 s. */
export const RELOAD_WITHOUT_IDS_TTL_MS = 55_000;
/** Ordem em voo sem nenhum sinal do executor por este tempo vira `unknown` (EXECUTOR_SEM_RESPOSTA). */
export const LIVE_LIMIT_MS = 180_000;
/** Ordem que NUNCA saiu do navegador (ainda `queued`) e ninguém despachou: expira — é seguro refazer. */
export const QUEUED_TTL_MS = 10 * 60_000;
/** Resultados e ordens terminais ficam no journal por este tempo (depois são podados). */
export const JOURNAL_RETENTION_MS = 14 * 24 * 60 * 60_000;

/**
 * "Limpar" do popup só apaga ordem CONCLUÍDA depois que o site já leu o MP4 inteiro há pelo menos isto (folga para o envio ao
 * servidor local e eventuais repetições). Apagar antes faria o site perder o clipe pago: ORDEM_NAO_ENCONTRADA → gerar/cobrar de novo.
 */
export const DELIVERY_GRACE_MS = 10 * 60_000;

/** Máximo de ordens em voo por conta (o original permite até 4). */
export const MAX_IN_FLIGHT = 4;

// ─── mensagens do site ───────────────────────────────────────────────────────────────────────────────────────────
/** `id` de pedido: string de 1..128 caracteres. */
export const isValidMessageId = (id) => typeof id === 'string' && id.length >= 1 && id.length <= 128;

export const ZRE_REQUEST = 'request';
export const ZRE_RESPONSE = 'response';
export const ZRE_HEALTH = 'flow-health';

/** Chaves do chrome.storage.local compartilhadas entre service worker, relay e abas. */
export const SETTINGS_KEY = 'zr:v1:settings';
/** Saúde sanitizada: o relay do site a empurra para a página como `flow-health`. */
export const STATUS_KEY = 'zr:status';

/** Contexto de conta do Flow: `{accountId: e-mail, projectId: uuid, accountPath: '' | '/u/N'}`. */
export const UUID_RE = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export const ACCOUNT_PATH_RE = /^(|\/u\/\d+)$/;
export const EMAIL_RE = /^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/;

export function validContext(c) {
  return !!c && typeof c.accountId === 'string' && EMAIL_RE.test(c.accountId) && typeof c.projectId === 'string' && UUID_RE.test(c.projectId) && typeof c.accountPath === 'string' && ACCOUNT_PATH_RE.test(c.accountPath);
}
export const canonicalContext = (c) => ({ accountId: c.accountId.toLowerCase(), projectId: c.projectId.toLowerCase() });
/** Dono de uma ordem = conta (e-mail) + projeto. `/u/N` é só um endereço mutável. */
export const scopeOf = (c) => `${c.accountId.toLowerCase()}|${c.projectId.toLowerCase()}`;

// ─── argumentos de `generate.video` ─────────────────────────────────────────────────────────────────────────────
export const MAX_PROMPT_CHARS = 3000;
export const MAX_REFERENCE_BYTES = 12 * 1024 * 1024;
export const MAX_CLIP_BYTES = 64 * 1024 * 1024;
export const REFERENCE_MIMES = ['image/png', 'image/jpeg', 'image/webp'];
export const ASPECT_RATIOS = ['9:16', '16:9'];

/** Valida `args[0]` de um `generate.video`. Devolve o código do erro ou null. */
export function validateVideoArgs(args) {
  const o = Array.isArray(args) ? args[0] : undefined;
  if (!o || typeof o !== 'object') return 'ARGUMENTOS_OBRIGATORIOS';
  if (typeof o.prompt !== 'string' || !o.prompt.trim()) return 'PROMPT_OBRIGATORIO';
  if (o.prompt.length > MAX_PROMPT_CHARS) return 'PROMPT_GRANDE_DEMAIS';
  if (!ASPECT_RATIOS.includes(o.aspectRatio)) return 'ASPECTO_NAO_SUPORTADO';
  if (o.durationSeconds != null && ![4, 6, 8].includes(o.durationSeconds)) return 'DURACAO_NAO_SUPORTADA';
  const f = o.firstFrame;
  if (f != null) {
    if (typeof f !== 'object' || !REFERENCE_MIMES.includes(f.mimeType)) return 'IMAGEM_MIME_NAO_SUPORTADO';
    if (typeof f.base64 !== 'string' || !f.base64 || f.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(f.base64)) return 'IMAGEM_BASE64_INVALIDO';
    if (f.base64.length > Math.ceil((MAX_REFERENCE_BYTES * 4) / 3)) return 'IMAGEM_GRANDE_DEMAIS';
  }
  return null;
}

/** Códigos de erro "da cota" que o app e o broker reconhecem (a extensão traduz as mensagens do Flow para eles). */
export const ERROR_CODES = {
  quota: 'COTA',
  unusual: 'INCOMUM',
  credits: 'CREDITOS_INSUFICIENTES',
  policy: 'CONTEUDO_RECUSADO',
  generic: 'FLOW_ERRO',
};

/** Tradução do texto de erro que o Flow mostra (várias línguas) para um código estável. */
export function errorCodeFromFlowText(text) {
  const t = String(text ?? '');
  if (/unusual\s+activity|atividade\s+incomum|actividad\s+inusual|recaptcha/i.test(t)) return ERROR_CODES.unusual;
  if (/(?<![0-9])429(?![0-9])|too\s+many\s+requests|quota|cota|limite\s+di[áa]rio|daily\s+limit|l[ií]mite\s+diario/i.test(t)) return ERROR_CODES.quota;
  if (/(not\s+enough|insufficient|out\s+of)\s+(ai\s+)?credits|sem\s+cr[ée]ditos|cr[ée]ditos\s+insuficientes|sin\s+cr[ée]ditos/i.test(t)) return ERROR_CODES.credits;
  if (/policy|safety|blocked|prohibited|pol[íi]tica|bloquead|recusad|seguran[çc]a|pol[íi]tica de uso/i.test(t)) return ERROR_CODES.policy;
  return ERROR_CODES.generic;
}
