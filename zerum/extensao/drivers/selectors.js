/**
 * ⚠ ÚNICO ARQUIVO com o que depende da APARÊNCIA do flow.google.com.
 *
 * O Flow não tem API pública: esta extensão opera a página como a própria pessoa faria (digita o prompt, anexa a imagem,
 * clica em gerar, espera o clipe e lê o vídeo). Tudo o que é "onde fica o botão X" mora aqui, em DADOS, para que uma
 * mudança no site se conserte editando só este arquivo — sem mexer no broker, no journal nem na ponte.
 *
 * COMO LER:
 *  - cada elemento lógico tem uma LISTA de estratégias, tentadas em ordem; a primeira que achar algo VISÍVEL vence;
 *  - `status: 'verificado'` = o padrão vem de código da extensão 0.4.18 que roda em produção (leitura do DOM do Flow);
 *    `status: 'palpite'`    = heurística razoável, NÃO observada ao vivo (isto aqui nunca foi testado numa conta real).
 *  - o botão "Diagnóstico do Flow" do popup roda `probe()` e mostra, elemento por elemento, o que foi achado — é a
 *    ferramenta para ajustar os "palpites" olhando a página real.
 *
 * TIPOS DE ESTRATÉGIA (resolvidos por drivers/dom-page.js):
 *  { css }                       seletor CSS
 *  { ariaLabel: RegExp }         atributo aria-label casando
 *  { text: RegExp, tag? }        texto visível do elemento (ignora o texto de ícones do Material, ex.: "arrow_forward")
 *  { icon: string, tag? }        ícone do Material (ligadura no texto, ex.: "arrow_forward") dentro de um botão
 *  { role, name?: RegExp }       atributo role (+ nome acessível)
 *  { mustContain }               filtro extra: o aria-label/texto precisa conter esta string (ex.: "@")
 */

export const FLOW_ORIGIN = 'https://flow.google.com';
/** Hosts de onde o MP4 pronto pode ser baixado (o service worker só busca nestes). */
export const MEDIA_HOSTS = ['flow-content.google'];

/** /u/N/project/<uuid> — endereço do projeto aberto (verificado: é como o Flow monta a URL). */
export const PROJECT_PATH_RE = /^(\/u\/\d+)?\/project\/([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})(?:\/|$)/i;

export const SELECTORS = {
  // ─── identidade ────────────────────────────────────────────────────────────────────────────────────────────────
  /** Botão da conta Google (topo): o aria-label tem "Google Account: Nome (e-mail)". Padrão da 0.4.18. */
  accountButton: {
    status: 'verificado',
    strategies: [{ ariaLabel: /(Google Account|Conta (?:do )?Google|Cuenta de Google)/i, mustContain: '@' }, { ariaLabel: /@/, mustContain: 'Google' }],
  },
  /** Aparece quando NÃO há login (a página pede "Sign in"). */
  signInButton: {
    status: 'palpite',
    strategies: [{ text: /^(sign in|fazer login|entrar|iniciar sesi[óo]n)$/i, tag: 'a' }, { text: /^(sign in|fazer login|entrar|iniciar sesi[óo]n)$/i, tag: 'button' }],
  },

  // ─── composição do pedido ─────────────────────────────────────────────────────────────────────────────────────
  /** Caixa onde se escreve o prompt (a de baixo da tela, a mais "larga"). */
  promptBox: {
    status: 'palpite',
    strategies: [{ css: 'textarea' }, { css: '[contenteditable="true"][role="textbox"]' }, { css: '[contenteditable="true"]' }, { css: 'input[type="text"]' }],
    pick: 'lastVisible',
  },
  /** Botão que envia o pedido (seta/“Create”/“Generate”). */
  generateButton: {
    status: 'palpite',
    strategies: [
      { text: /^(create|generate|criar|gerar|crear|generar)$/i, tag: 'button' },
      { ariaLabel: /^(create|generate|criar|gerar|crear|generar)\b/i },
      { icon: 'arrow_forward', tag: 'button' },
      { icon: 'send', tag: 'button' },
    ],
    pick: 'lastVisible',
  },
  /** Abre o painel de ajustes (modo, formato, quantidade, modelo). */
  settingsButton: {
    status: 'palpite',
    strategies: [{ ariaLabel: /(settings|ajustes|configura[çc][õo]es|options|op[çc][õo]es)/i }, { icon: 'tune', tag: 'button' }, { icon: 'settings', tag: 'button' }],
    pick: 'lastVisible',
  },
  /** Opções de modo (aba/menu): texto para vídeo, quadros para vídeo, ingredientes. */
  modeTextToVideo: { status: 'palpite', strategies: [{ text: /text\s*to\s*video|texto\s*(para|a)\s*v[ií]deo/i }] },
  modeFramesToVideo: { status: 'palpite', strategies: [{ text: /frames?\s*to\s*video|quadros?\s*(para|a)\s*v[ií]deo|imagem\s*(para|a)\s*v[ií]deo/i }] },
  /** Formato: retrato 9:16 / paisagem 16:9. */
  aspectPortrait: { status: 'palpite', strategies: [{ text: /^(9\s*:\s*16|portrait|retrato|vertical)$/i }, { ariaLabel: /(9\s*:\s*16|portrait|retrato|vertical)/i }] },
  aspectLandscape: { status: 'palpite', strategies: [{ text: /^(16\s*:\s*9|landscape|paisagem|horizontal)$/i }, { ariaLabel: /(16\s*:\s*9|landscape|paisagem|horizontal)/i }] },
  /** Quantidade de saídas por pedido: queremos UMA (cada clipe gasta crédito). */
  outputsOne: { status: 'palpite', strategies: [{ text: /^(x\s*1|1)$/i }, { ariaLabel: /^(x\s*1|1 (output|resultado))/i }] },
  /** Seletor de modelo (abre uma lista) e as opções da lista (casadas pelo NOME pedido). */
  modelPicker: { status: 'palpite', strategies: [{ ariaLabel: /(model|modelo)/i }, { text: /veo\s*\d/i, tag: 'button' }] },
  modelOption: { status: 'palpite', strategies: [{ role: 'option' }, { role: 'menuitem' }, { role: 'menuitemradio' }] },

  // ─── imagem de partida ────────────────────────────────────────────────────────────────────────────────────────
  /** `<input type=file>` (às vezes escondido; o driver injeta o arquivo direto nele). */
  fileInput: { status: 'palpite', strategies: [{ css: 'input[type="file"][accept*="image"]', hidden: true }, { css: 'input[type="file"]', hidden: true }] },
  /** Botão que abre a escolha de imagem (usado só se o `<input>` ainda não existir na página). */
  addImageButton: {
    status: 'palpite',
    strategies: [{ ariaLabel: /(add|upload|adicionar|enviar|subir)\b.*(image|imagem|media|m[ií]dia|frame|quadro)/i }, { icon: 'add_photo_alternate', tag: 'button' }, { icon: 'add', tag: 'button' }],
  },

  // ─── resultados (a grade de clipes do projeto) ────────────────────────────────────────────────────────────────
  /** Cartão de um clipe na grade. A identidade vem do uuid que o Flow põe em atributo/link/src. */
  tile: {
    status: 'palpite',
    strategies: [{ css: '[data-media-id]' }, { css: '[data-tile-id]' }, { css: 'a[href*="/edit/"]' }, { css: '[role="listitem"]' }, { css: 'li' }],
  },
  /**
   * Mensagem de falha DENTRO do cartão. Ancorada no INÍCIO do texto de propósito: o cartão pode repetir o prompt, e uma
   * palavra como "erro" no meio do prompt não pode virar "falha de geração".
   */
  tileError: { status: 'palpite', strategies: [{ text: /^\W*(failed|generation failed|falhou|something went wrong|n[ãa]o foi poss[ií]vel|couldn.?t generate|unable to generate|error|erro)\b/i }] },
  /** Progresso "37%" dentro do cartão enquanto gera. */
  tileProgress: { status: 'palpite', strategies: [{ text: /\b\d{1,3}\s?%/ }] },

  // ─── créditos ─────────────────────────────────────────────────────────────────────────────────────────────────
  /** Texto com o saldo (ex.: "1,250 AI credits"). Lido por regex no texto visível. */
  creditsText: { status: 'palpite', strategies: [{ text: /\d[\d.,]*\s*(ai\s*)?(credits?|cr[ée]ditos?)/i }] },
};

/**
 * Avisos (toast/snackbar/alert) que contam como RECUSA do pedido: só os que falam de erro/limite/cota/crédito.
 * (Um aviso informativo — "adicionado ao projeto" — não pode fazer o driver desistir de um envio que deu certo.)
 */
export const ALERT_RE = /(failed|falhou|erro|error|quota|cota|limit|limite|credit|cr[ée]dito|unable|couldn.?t|something went wrong|n[ãa]o foi poss[ií]vel|blocked|bloquead|policy|pol[ií]tica|too many|muitas|try again|tente novamente|insufficient|insuficiente|exceeded|excedeu|unusual|incomum|429)/i;

/** Expressão que extrai o número de créditos de um texto (aceita 1,250 / 1.250 / 1250). */
export const CREDITS_RE = /(\d[\d.,]*)\s*(?:ai\s*)?(?:credits?|cr[ée]ditos?)/i;
/** Ligaduras do Material Icons que aparecem como texto dentro de botões e devem ser ignoradas ao ler rótulos. */
export const ICON_WORDS = /\b(arrow_forward|arrow_upward|send|tune|settings|add|add_photo_alternate|close|more_vert|expand_more|expand_less|check|download|content_copy|delete|play_arrow|pause)\b/g;

/** Textos de modelo/mensagem que o Flow usa e a extensão reconhece (para diagnóstico, não para decisão). */
export const NOTES = [
  'status "palpite": nunca testado numa conta real do Flow — rode o Diagnóstico do popup e ajuste este arquivo.',
  'O vídeo pronto deve ser lido do <video> do cartão (src https://flow-content.google/... ou blob:).',
];
