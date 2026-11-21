// Content script injetado no Google Flow (https://labs.google/fx/*).
//
// FASE 1: STUB — não interage com a página. Este arquivo documenta o plano da automação.
//
// ───────────────────────── PLANO DE AUTOMAÇÃO (FASE 2) ─────────────────────────
//
// Contrato com o estúdio (background.js ↔ content.js ↔ API):
//   1. background recebe no heartbeat uma tarefa:
//        { id, kind: 'image' | 'video', prompt, model, resolution, format,
//          referenceImages: [url...], baseImageUrl?: url, accountEmail }
//      O estúdio escolhe `accountEmail` com a rotação de contas (acquireAccount):
//      ≥ 40 créditos, máx. 2 vídeos e 2 imagens por conta por ciclo.
//   2. background garante que a aba do Flow está logada na conta correta
//      (se não, pede troca de conta e aguarda) e envia RUN_TASK a este script.
//   3. Este script executa na página:
//        a. Imagem-base: abrir novo projeto → modo "Imagem" → anexar fotos de referência do avatar →
//           colar o prompt (gerado pelo Gemini, com a descrição do personagem) → escolher formato → gerar.
//        b. Vídeo: modo "Imagem para vídeo" → anexar a imagem-base → colar o prompt → escolher modelo
//           (Veo 3.1 Lite / Fast / Quality / Omni 1.1 Flash) e resolução (720p/360p) → gerar.
//   4. Aguardar a conclusão observando a página com MutationObserver (nunca com sleeps fixos):
//        sucesso  → localizar o <video>/<img> resultante e baixar o arquivo;
//        falha    → capturar a mensagem de erro exibida (fila cheia, política de conteúdo, sem créditos).
//   5. Ler o saldo de créditos exibido na interface e reportá-lo ao estúdio (atualiza `google_accounts.credits`).
//   6. Devolver ao background: { taskId, ok, fileBase64|uploadUrl, error?, credits }.
//      O estúdio grava em outputs/<job>/ e marca o item como `done` (is_placeholder = 0) ou conta
//      a tentativa como falha (retry até MAX_ATTEMPTS_PER_ITEM, limitado pelo teto de gerações).
//
// Princípios de robustez:
//   - Seletores centralizados em um único objeto (SELECTORS): a UI do Flow muda e só ele precisa ser ajustado.
//     Preferir atributos estáveis (aria-label, role, data-*) a classes geradas.
//   - Toda espera é por condição (MutationObserver + timeout), com mensagens de erro específicas por etapa.
//   - Um item por vez por conta; respeitar o limite por ciclo vindo do servidor.
//   - Nunca enviar cookies/credenciais ao estúdio: apenas os arquivos gerados e o saldo de créditos.
//
// Esqueleto do listener (ainda sem automação):

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'PING') {
    sendResponse({ ok: true, page: location.href, phase: 1 });
    return; // resposta síncrona
  }
  if (msg?.type === 'RUN_TASK') {
    // Fase 2: executar a tarefa (ver plano acima).
    sendResponse({ ok: false, error: 'Automação do Flow ainda não implementada (fase 2).' });
    return;
  }
});
