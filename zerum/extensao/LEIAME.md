# Extensão Zerum · Flow (local)

Extensão do Chrome (**Manifest V3**) que deixa o Zerum **gerar vídeo de verdade no Google Flow**, operando o
`flow.google.com` na conta Google que **você** já tem logada. É o executor real da ponte `window.postMessage` que o app
(`../src/lib/bridge/`) já falava.

- **Reescrita própria** (fase 3), a partir do *estudo* da extensão Zerum 0.4.18 da 001.community
  (`reference/zerum-001/extensao-0.4.18/`): mesmas mensagens `zre`, mesmos estados, mesma política de cota. **Nenhum código
  foi copiado** — a extensão original pertence à 001.
- **Sem login da 001, sem servidor, sem telemetria.** O único tráfego é (1) a ponte `postMessage` com a página do Zerum
  neste computador e (2) o próprio `flow.google.com` / `flow-content.google` (baixar o MP4 pronto). Nada de contas, cookies
  ou vídeos vai para outro lugar (um teste de AST — `test/network-audit.test.mjs` — falha se aparecer qualquer outra rede).
- **Não usa a API interna do Flow, não captura token do reCAPTCHA, não chama RPC escondido.** Ela opera a página como a
  pessoa faria (digita o pedido, anexa a imagem, clica em gerar, espera o clipe, lê o vídeo). Por isso depende da
  **aparência** do site — e isso fica isolado em [`drivers/`](drivers/LEIAME.md).

## Instalar

1. Chrome → `chrome://extensions` → ligue o **Modo do desenvolvedor**.
2. **Carregar sem compactação** → escolha esta pasta (`zerum/extensao`, a que tem o `manifest.json`).
   Sem o repositório: no app, `/zerum/extensao` oferece o `.zip` (rota `/zerum/api/extension/package`) — extraia numa pasta
   permanente.
3. Abra o Flow pelo ícone da extensão (**Abrir o Flow**), entre na sua conta Google e **abra/crie um projeto**.
4. No Zerum, clique em **Conectar o Flow** (ou espere a pílula ficar verde) e desligue **⚙ → Simulação local**.

Requisitos: Chrome/Chromium recente com MV3 e uma conta Google **com créditos do Flow** (cada clipe de cena gasta crédito
dessa conta). Se o Zerum não roda em `127.0.0.1:3100`/`localhost:3100`, acrescente o endereço em **Sites autorizados** no
popup da extensão.

## Arquitetura

```
 página do Zerum (127.0.0.1:3100)                                       aba do Flow (https://flow.google.com)
 ┌────────────────────────────┐                                         ┌─────────────────────────────────────┐
 │ BridgePump (src/lib/bridge)│  postMessage {zre}                      │ flow-worker.js  (content script)    │
 │  · pega cenas no servidor  │◄───────────────┐                        │  · bate o coração a cada ~3 s       │
 │  · enqueue/get/download    │                │                        │  · executa pelo DRIVER (DOM)        │
 │  · devolve o MP4 ao app    │                ▼                        │  · journal da aba + outbox          │
 └────────────────────────────┘   ┌──────────────────────┐              └──────────────▲──────────────────────┘
                                   │ site-relay.js        │                             │ chrome.runtime
                                   │ (content script no   │  chrome.runtime             │ (rpc heartbeat · worker.*)
                                   │  site do Zerum)      │──────────┐                  │
                                   └──────────────────────┘          ▼                  │
                                                          ┌──────────────────────────────────────────┐
                                                          │ service worker (background/)             │
                                                          │  · BROKER: ordens + journal (storage)    │
                                                          │  · media-store: MP4 em partes de 1 MiB   │
                                                          │  · política: origens, hosts de mídia     │
                                                          └──────────────────────────────────────────┘
                                                                       ▲
                                                          popup (contas · pausa · origens · diagnóstico)
```

| Arquivo | Papel |
| --- | --- |
| `manifest.json` | permissões mínimas: `storage`, `unlimitedStorage`, `alarms`; hosts só `flow.google.com` e `flow-content.google`; relay só em `127.0.0.1`/`localhost` |
| `lib/protocol.js` | constantes e funções puras do contrato (estados, transições, cota, prazos, validação de argumentos) — espelha `src/lib/bridge/` (teste de contrato) |
| `lib/kv.js`, `lib/util.js` | armazenamento injetável (`chrome.storage.local` ou memória nos testes), mutex, hash, base64 |
| `background/broker.js` | **o broker**: máquina de estados, idempotência por chave, *leases*, outbox/ack, reconciliação, pausa de cota |
| `background/media-store.js` | guarda o MP4 baixado em partes (≤ 1 MiB) com SHA-256, até o app buscar |
| `background/policy.js` | quem pode falar com a extensão (origens do Zerum, aba do Flow, popup) e de onde se baixa mídia |
| `background/sw-core.js` | roteia as mensagens para o broker; calcula a saúde; **sem efeitos globais** (roda igual no Node dos testes) |
| `background/service-worker.js` | só liga o núcleo aos eventos do Chrome (mensagens, alarme `zerum-tick` a cada 30 s) |
| `content/site-relay.js` | ponte entre a página do Zerum (`postMessage`) e o service worker (`chrome.runtime`) |
| `content/flow-worker.js` | o worker da aba do Flow: heartbeat, execução, journal, entrega de mídia |
| `drivers/` | **tudo o que depende da aparência do Flow** (seletores + automação do DOM) — ver [`drivers/LEIAME.md`](drivers/LEIAME.md) |
| `popup/` | contas (créditos, pausa), sites autorizados, "Diagnóstico do Flow", ordens recentes, limpeza |

## Protocolo

### Página ⇄ extensão (`window.postMessage`, mesma janela e mesma origem)

```
página → extensão   { zre: 'request',  id, action, payload }
extensão → página   { zre: 'response', id, result }                          // sucesso
                    { zre: 'response', id, error, code?, retryable?, retryAt?, action? }
extensão → página   { zre: 'flow-health', health }                           // push: saúde sanitizada (nunca token/journal)
```

- `id`: texto de 1 a 128 caracteres. Mensagem de outra janela/origem, sem `zre`, com `id` inválido ou ação fora da lista é
  **ignorada em silêncio**.
- Se a extensão não responde em **25 s**, o app devolve `EXTENSAO_SEM_RESPOSTA; pedido preservado, não gerar outra vez`:
  o pedido **não** é reenviado — reconcilia-se (`get`/`reconcile`), nunca se repete o *submit*.
- Marcas no `<html>`: `data-zerum-extension` (versão) e `data-zerum-extension-origin="allowed|blocked"` — o app as lê para
  distinguir "não instalada" de "instalada mas esta origem não está autorizada".

| Ação | Faz | Devolve |
| --- | --- | --- |
| `extensionStatus` | retrato da extensão | `{installed, paired, version, protocol, health, accounts[], tabs[], origins[]}` |
| `accounts` | contas do Flow que já bateram o coração | linhas com `credits`, `cooldownUntil`, `paused`, `pending`, `online`… |
| `enqueue` | cria a ordem **idempotente** (`jobId`, `context`, `cmd:'generate.video'`, `args`, `key`, `attempt`) | a ordem (`state: queued…`) — a mesma `key` devolve a **mesma** ordem |
| `get` | lê uma ordem | a ordem (estado, `error`, `result{mediaRef,bytes,sha256,parts}`) |
| `reconcile` | releitura **só leitura** de uma ordem `unknown` | a ordem (vira `completed`/`failed` ou continua `unknown`) |
| `download {id, part}` | lê o MP4 **da extensão para a página** em partes (≤ 1 MiB em base64) | `{part, parts, size, sha256, base64, done}` |
| `job` / `beginAttempt` | tentativa atual de um job / abre a **próxima** (só se nada está pendente nem incerto) | `{attempt, …, context}` |
| `mediaState {mediaId}` | de que conta/projeto é uma mídia | `{context}` |
| `recoverJob` | o que fazer com um job depois de resposta perdida/queda | `{status: 'reconciling' \| 'completed' \| 'released', operationId, …}` |

> Diferença deliberada para o original: lá o `download` salvava o arquivo no disco do usuário; aqui ele **devolve os bytes
> à página**, que os entrega ao servidor local do Zerum (`PUT /api/bridge/scenes/:video/:idx/clip`) para juntar as cenas.
> Não existe a ação `connect` (login/código `ZR-…` da 001).

### Dentro da extensão (`chrome.runtime`)

| Mensagem | De → Para | Para quê |
| --- | --- | --- |
| `rpc` + `action` | relay → service worker | repassa uma das 10 ações da ponte (só de origem autorizada) |
| `site.hello` | relay → service worker | "esta origem é permitida?" + saúde (para o `flow-health` e as marcas do `<html>`) |
| `rpc heartbeat` | aba do Flow → service worker | entrega o outbox de eventos, recebe ordens (com *lease*) |
| `worker.observe` | aba do Flow → service worker | quem está logado, projeto aberto, pronto ou não (e por quê) |
| `worker.media.{fetch,begin,chunk,end}` | aba do Flow → service worker | entrega o MP4 pronto (o service worker baixa de `flow-content.google`, ou a aba envia em partes se for `blob:`) |
| `flow.pulse` / `flow.query-info` / `flow.probe` | service worker/popup → aba do Flow | acordar a aba, ler identidade, rodar o diagnóstico |
| `popup.*` | popup → service worker | status, pausa por conta, origens, opções, diagnóstico, limpeza |

## Estados e garantias (as regras da 0.4.18)

```
queued → dispatched → accepted → completed | failed | unknown
                                   unknown → completed | failed   (só por RECONCILIAÇÃO — jamais volta a queued/dispatched)
```

- **Nunca gera duas vezes.** Falha **antes** do clique = `failed` (seguro refazer). Incerteza **depois** do clique = `unknown`:
  o bloqueio da conta é preservado e a geração **não** é reenfileirada. O driver só *observa* depois de clicar.
- **Chave estável** (`jobId` + contexto + comando + argumentos): reenviar o mesmo pedido (resposta perdida, página
  recarregada) devolve a mesma ordem. Idempotência por `(job, chave, tentativa)` + impressão digital dos argumentos.
- **Journal antes de responder**: o broker grava em `chrome.storage.local` *antes* de responder; reiniciar o service worker
  não perde nada. A aba do Flow tem o próprio journal (`zr:journal:<worker>`): recarregar a aba **não reenvia** — o que
  estava em voo vira `unknown` (`ABA_RECARREGADA_SEM_REENVIO`) com a identidade do cartão, e a releitura é só leitura.
- **Outbox/ack**: confirmação perdida repete a **entrega** do resultado, nunca a geração.
- **Cota**: `429`/`QUOTA`/`COTA` → **pausa de 24 h** da conta; `INCOMUM`/`UNUSUAL`/`RESOURCE_EXHAUSTED` → 5 min. A extensão
  **nunca** troca de conta ou de modelo para contornar cota; trocar de conta é decisão do app (e só com a "troca
  automática" ligada no ⚙).
- **Prazos**: presença da conta 90 s · ordem em voo sem sinal do executor 180 s → `unknown` · `unknown` com identificação é
  reconciliável por 12 min · `unknown` sem identificação libera como falha explícita em 55 s · `queued` que ninguém
  despachou expira em 10 min (seguro refazer) · journal podado após 14 dias.

## Segurança e privacidade

- **Origens**: só `http://127.0.0.1:3100` e `http://localhost:3100` por padrão (o popup adiciona outras). O relay confere
  `e.source === window` e `e.origin === location.origin`; o service worker confere o remetente de **cada** mensagem (site,
  aba do Flow, popup) e rejeita o resto.
- **Mídia**: só baixa de `flow-content.google` (https), exige o *lease* da ordem, limita a 64 MiB e confere a assinatura
  `ftyp` do MP4.
- **Sem telemetria**, sem `eval`, sem scripts remotos, sem recursos externos no popup.
- **Nada do Flow vira dado da página**: a página só recebe a saúde sanitizada, as ordens (sem argumentos nem *lease*) e os
  bytes do MP4 que ela mesma pediu.

## Testes

Tudo roda com `npm test` (sem Chrome, sem rede): o "mundo" de teste (`test/world.mjs`) simula `chrome.*`, `window` e uma
página falsa do Flow (`test/mock-page.mjs`).

| Arquivo | O que prova |
| --- | --- |
| `broker.test.mjs` | máquina de estados, idempotência, *leases*, outbox, `unknown`/reconciliação, cota (429 → 24 h), prazos, persistência |
| `sw-core.test.mjs` | roteamento, remetentes aceitos/rejeitados, saúde, popup, `download` em partes |
| `relay.test.mjs` | `postMessage` ⇄ `chrome.runtime`: o que é ignorado, marcas do `<html>`, `flow-health` |
| `worker.test.mjs` | aba do Flow: heartbeat, execução, recarga sem reenvio, entrega de mídia, falhas |
| `driver.test.mjs` | regra "falha antes do clique = failed; incerteza depois = unknown" sobre a página falsa |
| `contract.test.mjs` | **o contrato nos dois lados** (app TS × extensão JS): ações, estados, transições, cota, prazos, validação |
| `network-audit.test.mjs` | AST: nenhuma rede além do `flow.google.com`/`flow-content.google` e da ponte; manifest mínimo |
| `chain.test.mjs` | **cadeia completa em processo**: serviços do servidor + bomba da página + relay + service worker + worker + página falsa (vídeo de várias cenas, cota, recarga, reinício) |
| `smoke-http.test.mjs` | *(opcional)* HTTP contra um `next start` de verdade — `ZERUM_SMOKE_BASE=http://127.0.0.1:3101` |
| `e2e-browser.test.mjs` | *(opcional)* **navegador real** (Edge/Chrome headless com a extensão carregada) + app + Flow falso HTTPS — `ZERUM_E2E_CDP`, `ZERUM_E2E_APP` |

## Limitações conhecidas

- **Os seletores do Flow nunca foram observados numa conta real.** Só o botão da conta é "verificado" (vem do código da
  0.4.18); o resto (caixa do prompt, botão gerar, anexo de imagem, grade de clipes, créditos…) é *palpite*. Antes da
  primeira geração real, rode o **Diagnóstico do Flow** no popup com o Flow aberto e ajuste
  [`drivers/selectors.js`](drivers/selectors.js) conforme o relatório.
- A extensão só gera se conseguir garantir **uma saída por pedido** (cada clipe gasta crédito): sem o seletor de
  quantidade ela recusa. Quem sabe que o Flow da conta já está em 1 resultado por pedido liga **"O Flow já está em 1
  resultado por pedido (não mexer)"** no popup.
- A aba do Flow precisa ficar **aberta** (pode ficar em segundo plano, não minimizada) e a aba do Zerum também (é ela que
  leva as cenas à extensão e guarda o MP4).
- Só `generate.video` é executado. `generate.image`, `upload`, `save`, `generate.text` e `media.getBase64` são aceitos pelo
  broker (mesmo conjunto do original), mas o worker responde `COMANDO_NAO_SUPORTADO_*`.
- Legenda e balão do Zerum **não** são gravados no MP4 (o clipe é o que o Flow gerou); cenas só são juntadas se tiverem o
  mesmo codec/parâmetros (`concatMp4` recusa o resto com o motivo).
- Escolha de modelo do Flow é opcional (`args[0].model`) e ainda não aparece na interface do Zerum.
