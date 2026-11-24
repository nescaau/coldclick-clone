# Zerum 001 — clone local (fase 3: executor real pela extensão do Chrome)

Réplica local do **Zerum**, o estúdio da 001.community (`https://001.community/zerum`, embutido por iframe em
`/zerum/index.html`). Este módulo é um **app separado** dentro do repositório do ColdClick; não importa nem altera o
Estúdio Criativo (`src/`, `data/`, `reference/`).

> **Requisito central do dono: SEM LOGIN, SEM ASSINATURA, SEM ANTIGRAVITY.** Abre e usa. **O app não faz nenhuma chamada
> de rede externa.** O único tráfego permitido é a ponte `window.postMessage` com a **extensão do Chrome** que vem junto
> (`extensao/`, ver "Geração real pelo Flow"); é ela — e só ela — que conversa com o `flow.google.com`, na **sua** conta,
> no **seu** navegador.
>
> Há **três modos de execução**, e o app sempre diz em qual está:
> **simulado** (⚙ → Simulação local, **padrão**: as cenas avançam pelo relógio e o vídeo "pronto" é uma cópia do viral,
> com o selo **SIMULADO**) · **real** (simulação desligada + extensão conectada ao Flow: cada cena é gerada de verdade e o
> vídeo pronto é o **MP4 baixado do Flow**) · **espera** (simulação desligada e sem extensão: o lote fica na fila com
> `EXTENSAO_NAO_INSTALADA`, nada é enviado a lugar nenhum). Detalhes em "Execução: simulada × real".

## O que existe (fluxos de ponta a ponta)

| Fluxo | Como funciona |
| --- | --- |
| **Conversas** | criar, renomear, trocar, apagar (com eventos); histórico de mensagens do Diretor persistido; modos viral/ideia |
| **Viral** | upload MP4 (≤ 60 MB, validado por `ftyp`, dedupe sha256) → **leitura local**: duração, dimensões e faixas de áudio/vídeo lidas **do próprio arquivo** (parser de `moov`/`mvhd`/`tkhd`) → aparece em **ANALISADOS**. Gancho/estrutura/falas ficam **vazios** (não há IA) até o usuário preencher em **"A leitura errou? Corrigir"** (formulário "Alterar análise": pessoas, tela, cenas, fala, estrutura, enquadramento; "voltar à original") |
| **Diretor** | pedido em linguagem natural → **plano com passos e `requer_confirmacao`** ("o Diretor mostra os passos, você confirma, e a ferramenta executa") → **Executar N passos** → lote em PRODUÇÃO. Refinar ("faz 20", "troca a abertura") substitui o plano pendente. "Aprovar tudo automaticamente" (⚙) executa sem clique. Interpretação por palavras-chave (quantidade, igual/adaptar, variação, idioma, palavra, "avatares novos") — **sem IA** |
| **Manual** | os 4 passos da aba (1 qual viral · 2 igual ou adaptado + variação · 3 quem aparece e quantos · 4 gerar) com "PEDIDO", nome do lote, balão, idioma, observações, "Falta:" e LOG; **GERAR** cria o lote e abre a Produção |
| **Produção** | cartões de lote → vídeos → **cenas** com progresso, estados `na fila / gerando / PRONTO / FALHOU / cancelado / parado`, **Parar depois dos atuais**, **Continuar de onde parou**, **✕ Cancelar agora (2º clique)**, **↻ Regerar todas as cenas com falha**, **Baixar todos os prontos (zip)**, **✓ Aprovar lote → Vídeos**, **✕ Descartar lote (2º clique)**, log em tempo real (eventos persistidos). Na geração **real**, cada cena mostra o andamento do Flow e o log registra conta, tentativa e cota |
| **Vídeos** | "MEUS VÍDEOS": só os prontos, por lote (mais novo primeiro), com player e **⬇ Baixar MP4** (`Nome_12345.mp4`, código diferente em cada vídeo do lote). Vídeo **real** = o MP4 baixado do Flow (cenas juntadas, sem selo); vídeo **simulado** = cópia do viral, com o selo **SIMULADO** |
| **Avatares** | painel lateral com biblioteca: foto (JPG/PNG/WEBP ≤ 20 MB validada pelo conteúdo, `data/avatares/<sha256>.<ext>`) ou "Sem foto", criar/editar (lápis)/remover com diálogo de confirmação, **Selecionar vários** (apagar com 2º clique), **⬇ Baixar todos (zip)**, ✨ Gerar 1/4 (cartões sem foto) |
| **⚙ Configuração** | painel lateral conforme o original: Geração (simultâneos, imagem, cópia no Flow), **Legenda** (cor, ajustes avançados, ★ padrão), **Aprovação**, **Inteligência** (só preferência — ver "Recon de 24/11"), Seus limites, chave própria — tudo **persistido em SQLite** |
| **Conectar o Flow** | botão/pílula com o **estado real** da ponte: extensão instalada? conectada a este site? aba do Flow aberta e logada? contas (com créditos, quando o Flow informa), pausa por cota, "Tentar de novo". Sem extensão: passo a passo + **⬇ Baixar a extensão (.zip)** (`/zerum/extensao`, tudo dentro do app) |
| **Ponte site⇄extensão** | protocolo `zre` por `window.postMessage` (`src/lib/bridge/`) + a **extensão** (`extensao/`): broker com *journal*, cota, reconciliação — ver "Geração real pelo Flow" |

Fora de escopo (fase futura): leitura do viral por IA, roteirização por IA, "Editar" (editor de vídeo), variações de rosto
("Mesma pessoa, outro visual", "Pessoa nova parecida"), geração de **imagem**/rosto pelo Flow e a galeria do Flow. (Gerar
**vídeo** de verdade já existe — pela extensão.)

## Execução: simulada × real (leia antes de confiar num "PRONTO")

O app decide, a cada instante, **quem executa os lotes** (`executionMode()` em `services/bridge-service.ts`) e mostra isso
no log do lote, na pílula "Conectar o Flow" e na mensagem do Diretor:

| Modo | Quando | O que acontece | O vídeo "PRONTO" é… |
| --- | --- | --- | --- |
| **simulado** | ⚙ → *Simulação local da geração* **ligada** (**padrão**) | o relógio avança as cenas; a extensão **não** é usada | uma **cópia do viral** (ou um clipe de teste de 15 KB), com o selo **SIMULADO** |
| **real** | simulação **desligada** **e** a extensão relata o Flow pronto (retrato de até 15 s) | cada cena vira um pedido ao Flow pela extensão — **gasta crédito da sua conta do Flow** | o **MP4 baixado do Flow** (cenas juntadas), **sem** selo |
| **espera** | simulação **desligada** e **sem** extensão (ou Flow não pronto) | o lote fica `na fila`; o log diz `aguardando o executor do Flow (EXTENSAO_NAO_INSTALADA…)`; nada avança e nada é enviado | — (nada é gerado) |

A simulação é **por padrão ligada**: instalar a extensão não gasta crédito sozinha. O modo real só vale depois de **você**
desligar a simulação (o diálogo "Conectar o Flow" tem o botão, com o aviso de que gasta crédito).

### A simulação (modo simulado)

- cada **cena** leva `sceneMs` (2,5 s; `ZERUM_SIM_SCENE_MS` muda) e o número de cenas vem da duração do viral (clipes de 8 s;
  sem viral, 4);
- respeita **"Vídeos simultâneos"** do ⚙;
- o arquivo entregue em **⬇ Baixar MP4** é **uma cópia do viral** (ou, num lote sem viral, um clipe de teste de 15 KB embutido) —
  **não é uma geração**. Todo vídeo desse tipo mostra o selo **SIMULADO** e o log do lote diz isso. O selo continua em
  **todos** os fluxos simulados (⚙ ligado); só o vídeo gerado pelo Flow o perde;
- o avanço é **por leitura** (`tickBatches`): cada `GET` de Produção/Vídeos avança o relógio; não há timers nem processo em
  segundo plano, e o estado fica em SQLite (reiniciar o servidor não perde nada). O relógio **só** avança com a simulação
  ligada e **nunca** toca num vídeo real;
- **falhas**: a única falha "real" da simulação é o arquivo do viral ter sumido do disco (o vídeo falha com a causa). Para
  exercitar o estado `FALHOU` e o *Regerar*, o ⚙ tem **"Teste de falha: todo N-ésimo vídeo falha"** (0 = desligado).

## Geração real pelo Flow (extensão do Chrome)

O Flow não tem API pública. A extensão **opera a página do `flow.google.com`** na sua conta, como você faria: abre o
projeto, escolhe 9:16 e 1 resultado, anexa a foto do avatar, escreve o pedido da cena, clica em gerar, espera o clipe e lê
o MP4. **Não usa API interna do Flow nem captura token do reCAPTCHA.** Arquitetura, protocolo e garantias em
[`extensao/LEIAME.md`](extensao/LEIAME.md); a parte frágil (seletores) está isolada em
[`extensao/drivers/`](extensao/drivers/LEIAME.md).

### Instalar

1. **Requisito**: Chrome (ou Chromium) recente e uma **conta Google com créditos do Flow** — cada clipe de cena (até 8 s)
   gasta crédito dela.
2. `chrome://extensions` → ligue o **Modo do desenvolvedor** → **Carregar sem compactação** → escolha a pasta
   **`zerum/extensao`** (a que tem o `manifest.json`). Sem o repositório: em `http://127.0.0.1:3100/zerum/extensao` há o
   passo a passo e o **⬇ .zip** (rota `/zerum/api/extension/package`) — extraia numa pasta permanente.
3. Pelo ícone da extensão, **Abrir o Flow**; entre na SUA conta Google e **abra (ou crie) um projeto** — o Zerum gera dentro dele.
4. No Zerum, recarregue (F5) e abra **Conectar o Flow**: com a extensão, o Flow aberto e uma conta, aparece **● Conectado**
   (conta, créditos quando o Flow informa). Se o Zerum roda numa porta diferente de 3100, adicione o endereço em **Sites
   autorizados** no popup da extensão.
5. **Desligue ⚙ → Simulação local** (o botão "Desligar a simulação e gerar de verdade" está no próprio diálogo). A partir
   daí, lotes na fila são executados de verdade.

### Como uma geração real acontece

```
Diretor/Manual → lote na fila ─(servidor)→ claim: reserva UMA cena (prompt, 9:16, 8 s, foto do avatar, conta)
    ▲                                              │
    │ MP4 da cena (PUT)                            ▼
 servidor ◄── aba do Zerum (a "bomba") ──postMessage──► extensão ──► aba do Flow: digita, clica em gerar, observa
    │            · enqueue (chave estável)              (broker + journal)        · lê o clipe pronto
    │            · get/reconcile (só leitura)           ◄── download em partes ◄── o service worker baixa o MP4
    ▼            · download → sha256 → upload
 última cena pronta → junta os clipes (remux MP4, sem recodificar) → vídeo PRONTO sem selo → ⬇ Baixar MP4
```

- **Uma cena = um clipe de até 8 s = um pedido** (job `cena:<vídeo>:<n>`). O prompt de cada cena leva a **fala daquela
  cena** (a transcrição do viral, ou a fala escrita/preenchida em "A leitura errou?") e o contexto do lote; nada é enviado
  sem fala/assunto (o prompt é validado **antes** de gastar crédito). A foto do avatar vai como imagem de partida.
- A **aba do Zerum é o orquestrador** ("bomba", `src/lib/bridge/pump.ts`): só **uma** aba por vez executa (liderança no
  servidor — duas abas gastariam crédito em dobro). **Deixe a aba do Zerum e a do Flow abertas** enquanto gera.
- **Idempotência**: o pedido de cada cena tem chave estável. Aba recarregada, resposta perdida ou servidor reiniciado ⇒ a
  mesma cena é pedida de novo **com a mesma chave** e a extensão devolve a **mesma** ordem — nunca uma geração nova.
- **Estados da ordem** (os da 0.4.18): `queued → dispatched → accepted → completed | failed | unknown`. `unknown`
  (incerteza **depois** do clique: aba recarregada, Flow mudo) **não** reenfileira: só reconcilia lendo, ou expira como falha
  explícita avisando que **pode ter sido cobrada**.
- **Timeout 25 s**: sem resposta da extensão, `EXTENSAO_SEM_RESPOSTA; pedido preservado, não gerar outra vez` — o pedido
  fica preservado e o Zerum nunca gera de novo por conta própria.
- **Cota**: `429`/`QUOTA`/`COTA` ⇒ a conta fica em **pausa de 24 h** (mostrada em "Contas Flow"; `INCOMUM`/`UNUSUAL`/
  `RESOURCE_EXHAUSTED` ⇒ 5 min). Conta em pausa nunca é candidata. Com **troca automática** ligada (⚙, painel Contas Flow:
  "trocar abaixo de N créditos"), **cada cena nova** escolhe a conta com saldo; a extensão **nunca** troca de conta/modelo
  sozinha para fugir da cota.
- **Falha**: antes do clique ⇒ a cena falha e **↻ Regerar** refaz só o que falta (cenas já baixadas ficam, 0 crédito
  de novo). Se as cenas foram baixadas mas não deu para juntar, o vídeo falha com o motivo e **↻ Tentar de novo** só tenta
  juntar (0 crédito).
- **Onde ficam os arquivos**: os clipes baixados em `data/flow/<sha256>.mp4`; o vídeo pronto é a junção deles. Nada do
  Flow sai deste computador.

### O que é diferente do simulado

| | Simulado | Real |
| --- | --- | --- |
| Gasta crédito | não | **sim** (1 clipe por cena, na conta escolhida) |
| Tempo | 2,5 s por cena | o do Flow (minutos por cena); exige abas abertas |
| Arquivo | cópia do viral/clipe de teste | MP4 baixado do Flow (cenas juntadas) |
| Selo SIMULADO | sim | **não** |
| Legenda/balão | só dados (não há render) | **não são gravados no MP4** (limitação — o clipe é o que o Flow gerou) |
| Falhas | só a de teste ⚙ e viral ausente | cota, conteúdo recusado, sem crédito, Flow fora do ar, junção |
| Sem extensão | funciona | o lote espera na fila (`EXTENSAO_NAO_INSTALADA`) |

### Limitações conhecidas / pendências

- **Os seletores do Flow nunca foram observados numa conta real.** Só o botão da conta é "verificado"; o resto (caixa do
  prompt, botão gerar, anexo, grade de clipes, créditos) é *palpite* — veja o checklist em
  [`extensao/drivers/LEIAME.md`](extensao/drivers/LEIAME.md). Use o **Diagnóstico do Flow** no popup da extensão antes da
  primeira geração real. **Nenhuma geração real foi feita nesta entrega** (só o caminho pronto e testado com Flow falso).
- Por segurança de crédito, a extensão **recusa gerar** se não conseguir garantir **1 resultado por pedido** (a menos que
  o popup tenha "O Flow já está em 1 resultado por pedido" marcado).
- As abas do Zerum **e** do Flow precisam ficar abertas (o Flow pode ficar em segundo plano, não minimizado).
- Só `generate.video` é executado; imagem/rosto gerado pelo Flow, upload avulso e galeria **não** (fase futura).
- Cenas só são juntadas se tiverem o mesmo codec/parâmetros (remux sem recodificar); senão o vídeo falha com o motivo.
- A escolha do **modelo** de vídeo do Flow é opcional na extensão (`model`) e ainda não aparece na interface.
- Fica fora do alcance de qualquer teste automatizado: o **reCAPTCHA/anti-robô do Flow** e mudanças de visual do site.

## Como rodar

```bash
cd zerum
npm install
npm run dev        # http://127.0.0.1:3100  (redireciona para /zerum)
# produção:
npm run build && npm run start
npm run typecheck
npm test           # vitest
```

- **Porta própria: 3100** (o Estúdio Criativo usa 3000) e **bind `127.0.0.1`** nos scripts.
- Todas as rotas ficam sob **`/zerum`** (`basePath`): página `/zerum`, API `/zerum/api/*`.
- Dados em `zerum/data/` (ignorado pelo git): **`zerum.db`**, **`virais/`** e **`avatares/`**. Troque com `ZERUM_DATA_DIR`
  (ver `.env.example`; tudo é opcional).
- Defesa de servidor local (`src/middleware.ts`): allowlist de `Host` em **todas** as rotas (DNS rebinding) e, em `/api`,
  checagem de origem em POST/PUT/PATCH/DELETE (CSRF); corpos JSON exigem `application/json`.
- Node ≥ 20.9 (testado em 24). `better-sqlite3` baixa o binário pré-compilado no `npm install`; fora isso, zero rede.
- **Extensão do Chrome**: pasta `extensao/` (instalar: ver "Geração real pelo Flow"). `ZERUM_EXTENSION_DIR` aponta para ela
  se o app rodar de uma cópia sem a pasta (o `.zip` de instalação sai dali). Os MP4 baixados do Flow ficam em `data/flow/`.
- Rodar `npm run build` **enquanto `npm run dev` está aberto** compartilha a pasta `.next` e confunde o servidor de
  desenvolvimento; para validar o build sem atrapalhar, faça numa cópia (foi o que a verificação desta rodada fez).

### Por que um app separado

Porta e processo próprios, dependências e banco próprios, zero risco de regressão no Estúdio Criativo. Única alteração fora
de `zerum/`: `"zerum"` está no `exclude` do `tsconfig.json` da raiz.

## Arquitetura

```
rota (src/app/api/**)  →  serviço (src/lib/services/*)  →  repositório (src/lib/repo/*)  →  SQLite
                              ↑ regras puras: src/lib/domain/*        zod = fonte única: src/lib/schemas.ts
```

- **Migrações append-only** em `src/lib/migrations.ts` (aplicadas por `migrate.ts` com `BEGIN IMMEDIATE` e
  `foreign_key_check`; versão em `PRAGMA user_version`). **v2** (esta fase): metadados/análise nos virais; sexo/foto/origem nos
  avatares; `batches` e `events` reconstruídas (estado `parado`, caminho/variação/avatares/observações; novos escopos de log);
  tabelas `videos` e `plans`. Lotes e virais criados na v1 são **atualizados no bootstrap** (vídeos/cenas e metadados), sem perda.
  **v3** (fase 3): `videos.mode` (`sim` | `real`) e `videos.real_json` (o estado de cada cena real: tentativa, chave, conta,
  hash do clipe baixado, reserva) — vídeos antigos entram como `sim`, nada muda para eles.
- `domain/` (puro, testado): opções do vídeo, Diretor (quantidade, título), **plano** (`plan.ts`: interpretação, passos),
  **produção** (`production.ts`: máquina de estados com relógio injetado), análise do viral, parser de MP4, foto do avatar, ⚙,
  **zip** em streaming.
- As **cenas não têm linha própria**: o estado de cada uma deriva de `scenes_done` / `fail_scene` do vídeo.
- `bridge/` (a PONTE, lado do site): `protocol.ts` (mensagens `zre` + schemas zod), `broker.ts` (estados e cota — espelho do
  broker da extensão), `status.ts` (`BridgeStatus`, `FlowExecutor`), `client.ts` (`BridgeClient`: `postMessage` + timeout de
  25 s), `executor.ts` (`ExtensionFlowExecutor`), `accounts.ts` (qual conta recebe a próxima cena), `pump.ts` (a "bomba" que
  roda na aba do Zerum), `work.ts` (formato das cenas reservadas).
- `services/`: `bridge-service.ts` (retrato da extensão, **modo de execução**, aba líder), `real-service.ts` (reserva de cenas,
  recebimento do clipe, montagem, falhas, retomada — o executor real **no servidor**), `flow-files.ts` (clipes em
  `data/flow/`), `extension-service.ts` (o `.zip` da extensão). `domain/`: `flow-prompt.ts` (prompt de cada cena),
  `real-run.ts` (estado/reserva/chaves de cada cena), `mp4-concat.ts` (junção de clipes por *remux*, sem recodificar).
- `extensao/` (a extensão): ver [`extensao/LEIAME.md`](extensao/LEIAME.md).
- API nova: `/plans/:id/confirm|cancel`, `/virals/:id/analysis[/revert]`, `/virals/:id/video` (Range), `/avatars/*` (foto,
  from-photo, generate, bulk-delete, zip), `/batches/:id/{stop,resume,retry,approve,cancel,zip}`, `/videos`,
  `/videos/:id/{download,retry}`, `/log`, `/settings/key`. Fase 3: `/bridge/{status,heartbeat,claim}`,
  `/bridge/scenes/:video/:idx/{progress,fail,clip}`, `/extension/package` (e a página `/zerum/extensao`).

## Travas do original removidas

| Trava no original | No clone |
| --- | --- |
| **Sessão 001.community** (`na("ingresso", …)`, 401, bloqueio de acesso) | **Não existe.** Proteção só de "este computador" (`127.0.0.1` + Host/origem) |
| **Assinatura** (app desktop "entre com o e-mail da sua assinatura") | Faixa "NOVO ZERUM — baixar instalador" **não reproduzida** (propaganda do instalador pago) |
| **Antigravity** (`PRECISA_CONECTAR`, cota por modelo) | **Não existe.** Sem IA externa; o Diretor é local. No ⚙ somem a linha "Antigravity / Desconectar" e as cotas **ANTIGRAVITY** de "SEUS LIMITES". **INTELIGÊNCIA** existe só como **preferência local sem efeito** ("cérebro"), com as 2 opções literais (ver "Recon de 24/11") |
| **Código de membro `ZR-…`** / MCP | Removido (`connect` fora de `BRIDGE_ACTIONS`). A seção **"CONECTAR A SUA IA (MCP)"** do ⚙ **não foi reproduzida**: depende do servidor da 001 e o próprio original diz que está desligado |
| **Extensão no flow.google.com** exigida | Continua **opcional**: o app inteiro funciona sem ela (simulação; o banner diz "Pode usar o Zerum normalmente"). Para gerar **de verdade** há agora a **extensão própria** (`extensao/`, reescrita a partir do estudo da 0.4.18 — sem login da 001, sem servidor, sem telemetria, instalada sem compactação pelo próprio usuário) |
| Endpoints do servidor da 001 | Substituídos por rotas locais `/zerum/api/*` sobre SQLite |
| **Confirmação do plano do Diretor** (`requer_confirmacao`) | **Agora replicada** (plano → Executar). O **portão de conferência de cenas** (`jev_portao_prompts`) continua fora: sem geração real não há cenas a conferir |
| "Sugestão ou bug" ia ao servidor da 001 | Só grava em `feedback` no `zerum.db` |
| Fontes/React/Tailwind por CDN | Self-hosted via npm. Zero requisição externa |

## Fidelidade visual e textos

Fontes, em ordem de autoridade: (1) os `ref-zerum-*.snap.txt` capturados na 001.community em 23/11/2026 (aba Manual, Produção,
Analisados, Vídeos, Avatares, ⚙, Diretor/ideia); (2) o app original `zerum-app.js` (só **estudo**: textos de estados que os
snaps não mostram — cartão de lote, 2º clique, plano, formulário "Alterar análise", diálogos de avatar; o JSX/CSS/lógica foram
reescritos); (3) `001-zerum.snap.txt` e `zerum-index.html` (casca). **Exceção declarada:** `normalizeHex` e `BALLOON_COLORS`
reproduzem quase linha a linha as funções `Wr`/`uE` do original (a paleta e o hex precisam ser idênticos).

### Recon de 24/11 (conta real do assinante: 5 avatares, 1 viral, LOG real)

Capturas `r10-producao/videos/analisados/manual`, `r11-config`, `r4-avatares` (+ shots) — **autoridade máxima**, acima dos
snaps de 23/11. O que mudou no clone por causa delas:

- **Selects do ⚙** (reais): "Vídeos simultâneos" = `[1,2,3,4]`; "Imagem" = **Nano Banana Pro / Nano Banana 2 / Nano Banana 2
  Lite** (o terceiro era `Nano Banana Lite`: corrigido; o valor já salvo é migrado em `getSettings()` — uma linha em
  `settings-service.ts`, coberta por teste); **INTELIGÊNCIA** = "Gemini 3.8 Flash (High) (padrão e recomendado)" / "Claude Opus
  5.5 (Medium)".
- **"PEDIDO"** (Manual): `… · Omni 1.1 Flash · <imagem><sufixo>` — `(melhor rosto)` só no Pro, `(rápido)` no 2 Lite, Nano Banana 2
  sem sufixo. Modelo de vídeo padrão **Omni 1.1 Flash**; o diálogo "Modelo de vídeo padrão" (💡 + "clique aqui" + ✕ Fechar) já
  existia, só o texto literal, sem modelos alternativos — "clique aqui" **abre o ⚙** (o que o original abre ali continua
  desconhecido; o clone só tem esse modelo).
- **"Falta:"** agora é `ℹ Falta: Qual palavra o público vai comentar? .` (o ponto final é um nó separado no original) e mostra
  **uma pendência por vez**. Evidência: no snap o viral não estava escolhido e nenhum avatar marcado, e mesmo assim só a palavra
  aparece. Os extras são **literais do bundle** (palavra → viral → marcados): "suba um viral e espere a leitura (passo 1)", "marque quem aparece (passo 3) — só os marcados entram no vídeo" e, com viral não lido, "o viral escolhido não foi lido — clique em \"tentar ler de novo\"". Notas: o nome "Claude Opus 5.5 (Medium)" veio do briefing da orquestração, **não de captura** (o bundle só tem "Contas com o Claude Opus 5.5 veem as duas opções aqui"; o sufixo "(padrão e recomendado)" está confirmado como anexo à opção padrão). A nota da Imagem em ⚙ (função `lle`) muda por modelo: Pro "Melhor rosto."; Nano Banana 2 "Equilíbrio entre rosto e velocidade."; 2 Lite "Mais rápido.".
- **ANALISADOS**: data no formato en-US `11/23, 07:50 PM` (`fmtDateTime`, vale p/ todo o app), meta só `32 s · data` (saiu o
  enquadramento), Gancho/Estrutura cortados em **200** caracteres + `...` (medido: os dois trechos do snap têm exatamente 200).
- **Avatares**: foto em pé **9:16**; grade de **2 colunas** em tela estreita (r4, ~930 px) e **4** em tela larga (r10, ~1900 px) —
  o ponto de troca (`xl` = 1280 px) é palpite. **Divergência do briefing:** os botões reais são `✨ Gerar 1`/`✨ Gerar 4`, `☑ Selecionar
  vários` e `👤 Mesma pessoa, outro visual` / `👥 Pessoa nova parecida` (o 🎲 só existe em `🎲 3 avatares novos`, no Manual) — mantive os
  literais dos snaps.
- **Já estavam corretos** (conferidos de novo, nada a mudar): textos de PRODUÇÃO vazia, VÍDEOS ("MEUS VÍDEOS" + vazio), Manual
  (passo 3, balão desligado, "observações", `quantos vídeos` como spinbutton, botão GERAR e a frase abaixo), "🎬 Diretor" em todas as
  abas menos DIRETOR, seções APROVAÇÃO e "SEUS LIMITES → CRÉDITOS DO FLOW".
- **INTELIGÊNCIA — decisão:** o clone **reproduz o select** (2 opções literais, persistido em `settings.brain`, validado), mas como
  **preferência sem efeito**: o Diretor é local e não chama IA. A nota do original ("Gemini = mais rápido… Quem assiste o viral é
  sempre o Gemini") fala de cota do Antigravity e seria falsa aqui, então o clone mostra um texto próprio dizendo isso. **Omitidos
  de propósito:** linha "Antigravity <e-mail> / Desconectar", cotas ANTIGRAVITY ("Gemini 99% · volta hoje às 03:03" etc.) e toda a
  seção **MCP** (o próprio original a marca como desligada).
- **Barra "Conectar o Flow" — reconciliação:** texto, estrutura e botão "Conectar agora →" do clone **já eram idênticos** ao
  original. A diferença está no estado: o painel "Contas Flow · candidata" do original mostra sempre a linha de status
  `EXTENSAO_SEM_RESPOSTA; pedido preservado, não gerar outra vez` (extensão instalada, sem resposta). O clone não tem extensão,
  então mostra o estado verdadeiro `EXTENSAO_NAO_INSTALADA; …` (agora **também no painel**, antes só no diálogo "CONECTAR O FLOW";
  clicar em "Atualizar contas" troca por "Nenhuma conta…"). O código `EXTENSAO_SEM_RESPOSTA` continua em `bridge/protocol.ts` para
  quando houver executor. Painel "Instalar extensão" no original tem links reais (0.4.18/INSTALAR.txt); no clone são rótulos
  desativados. **Atualização da fase 3:** com a extensão do Zerum instalada o painel passa a mostrar o estado real (contas,
  créditos quando o Flow informa, pausa por cota) e, quando a extensão **não responde em 25 s**, o literal do original
  `EXTENSAO_SEM_RESPOSTA; pedido preservado, não gerar outra vez`; "Instalar extensão" aponta para a **nossa** extensão
  (`/zerum/extensao`, dentro do app — o `INSTALAR.txt` da 001 não é usado).
- **Endereço MCP pessoal (`ZR-…`)** do `r11-config.snap.txt` **não foi copiado** para código nem para este README.

### Conferência item-a-item (script `grep` contra os snaps)

Foram feitas **584 verificações** (literais extraídos dos 7 snaps) e procurados no código (`src/**`, normalizando espaços/JSX): Manual 98 · Produção
37 · Analisados 31 · Vídeos 35 · Avatares 103 · ⚙ 195 · Diretor/ideia 85. O que **não** aparece como string contígua:

- **equivalentes** (o texto está no código quebrado em partes/CSS): `GERADOR E EDITOR AUTOMÁTICO 001` e `NADA EM PRODUÇÃO AGORA.`
  (maiúsculas por CSS), `(5)` (contador dinâmico), `🎲 3 avatares novos`, `Balão COMMENT: DESLIGADO`, `· 🎬`, `· 32 s · lido ✓`,
  `Cor <nome>` (aria-label gerado), `5 palavras`, o resumo `PEDIDO · …` (montado; coberto por teste com a frase literal);
- **da casca da 001, não do Zerum**: `🖥️ NOVO ZERUM…`, `Avisos, alt+T`, menu lateral, usuário logado;
- **dados de exemplo da conta capturada**: viral `REF_IA_76M_BEBIDA_32s`, avatares `PF 1`/`PERFIL n`, e-mail, endereço MCP, horários;
- **omitidos de propósito** (Antigravity/MCP — ver "Travas" e "Recon de 24/11"): `Desconectar`, a **nota** de INTELIGÊNCIA do
  Gemini (o select existe), cotas **ANTIGRAVITY** ("Gemini 99% · volta hoje às 03:03"), toda a seção **MCP**;
- **pílula** `○ CONTAS FLOW`: o clone usa `○ sem Flow · clique pra reconectar` (pedido do dono); `PILL_MODE = 'contas'` em
  `FloatingDock.tsx` troca.

Adicionado nesta rodada por causa da conferência: botão **"nova conversa"** no cabeçalho do DIRETOR e botão **"🎬 Diretor"**
nas abas fora do Diretor (ambos presentes nos snaps).

### Textos reescritos (sem fonte literal) — lista

Escritos para este clone; **não existem em nenhum snap nem no `zerum-app.js`**. Vários existem só porque o original tem IA/Flow
e o clone precisa **dizer a verdade** sobre o que é local:

- **Leitura/Diretor local**: "Li os dados do viral "X": … Gancho, estrutura e falas ainda não foram lidos … O que você quer
  fazer?" (o original: `Assisti o viral "X": … Toque n…`, cortado no snap); "Leitura local: só os dados do arquivo…"; linhas do
  log do viral; "log do viral"; `Entendi: …`; "Me conta o que você quer que eu monte."; "Primeiro arraste o vídeo viral acima…";
  "Plano cancelado…"; a frase final de cada modo, depois de "Feito: lote …" (**simulado**: "A geração está SIMULADA (⚙ →
  Simulação local)…"; **real**: "O Flow está conectado: cada cena será gerada de verdade na sua conta (gasta crédito do
  Flow)…"; **espera**: "Sem a extensão do Flow conectada (EXTENSAO_NAO_INSTALADA), o lote fica na fila…").
- **Plano**: os textos de cada passo; o selo "gasta crédito"; "✓ executado · abrir Produção"; "plano cancelado"; "substituído por
  um plano mais novo". (Literais do original: "Plano", "(você confirma; o que gasta crédito está marcado):", "Executar",
  "Executar N passos", "Fechado. Confira o plano aqui embaixo e clique em … — ou diga o que quer mudar.", "Executando o que
  você confirmou, na ordem…", "Feito: … Acompanhe no painel Produção; cada vídeo pronto entra em Vídeos.")
- **Produção**: selo **SIMULADO**; faixa de cenas; barra de progresso; "ver log / esconder log"; "terminou
  com falha"; todas as linhas de log do lote; os textos-padrão das cenas ("Cena k: fala nova sobre o mesmo assunto (o roteiro é
  escrito pela IA do Diretor — fase futura).", "Cena k: mesma fala do viral (a transcrição está vazia…)"); mensagem de falha real
  (arquivo do viral sumiu). (Literais do original: "Parar depois dos atuais", "Parando após os atuais…", "✕ Cancelar agora" /
  `✕ Confirmar: cancelar "…"?`, "↻ Regerar todas as cenas com falha (N)", "Baixar todos os prontos (N)", "✓ Aprovar lote →
  Vídeos", "✕ Descartar lote", "⬇ Baixar MP4", "↻ Tentar de novo", o aviso de 2º clique, a mensagem "O Google não conseguiu terminar
  esta cena…".)
- **Manual**: itens extras de "Falta:" (literais do bundle, em minúsculas: "suba um viral e espere a leitura (passo 1)", "marque quem aparece (passo 3) — só os marcados entram no vídeo"); "Guardando o viral…". (Os
  chips "usar este" / "✓ base do lote" são literais do `zerum-app.js`.)
- **Avatares**: avisos de "fase futura" (variações, galeria do Flow, ✨ Gerar sem foto); "Sem foto"; "SEXO?"; "Nenhum avatar ainda.
  Mande a sua foto, gere do zero ou preencha à mão."; diálogo de apagar ("Apagar "X"? A foto sai só deste computador…") e os
  títulos/rótulos do formulário do lápis; "Escolha se a pessoa é mulher ou homem…" e "Isso não é uma foto. Mande JPG, PNG ou WEBP."
  (**adaptados**: o original aceita HEIC; aqui não).
- **⚙**: nota da INTELIGÊNCIA ("Preferência guardada neste computador. Este clone não chama IA…"); linha "Zerum local — sem login · sem assinatura · sem Antigravity"; bloco "Simulação local da geração" e "Teste de falha";
  as linhas locais de "SEUS LIMITES" (VIRAL, LOTE, ROLETA); o texto da chave ("guardada · ••••1234", "Só pra quem ainda usa o modo
  antigo… Aqui ela só fica guardada neste computador — não é testada nem enviada"); "Padrão salvo: …". (Título "Diretor (modo
  antigo, chave própria)", "Apagar chave" e "Chave apagada." são literais do `zerum-app.js`.)
- **Vídeos / Analisados**: selo SIMULADO; "Leitura local: só os dados do arquivo (corrija no Diretor para preencher)."
- **Mensagens de erro da API** (rotas `/zerum/api/*`; o original responde pelo servidor da 001, então não há fonte): "Esse plano
  já foi executado." / "Esse plano não está mais valendo — use o mais recente."; "Só dá para parar um lote em andamento.";
  "Espere o lote terminar (ou cancele) antes de aprovar."; "Cancele o lote antes de descartar um vídeo em andamento.";
  "Esse lote já terminou: não há nada para cancelar."; "Esse lote não está parado."; "Nenhum vídeo com falha para refazer.".
- **Linhas de log da conversa** (Diretor): "Conversa criada."; "Plano montado (N passos) — aguardando confirmação."; "Plano
  confirmado e executado." / "Plano executado automaticamente (Aprovar tudo ligado no ⚙)."
- **Log geral do app**: "Memória local recuperada: N avatar(es), M vídeo(s) pronto(s) (neste computador)." — **reescrita** da
  linha do original "Memória de 23/11… recuperada" (a data e o texto dela não são reproduzidos; o clone diz o que de fato foi lido
  do SQLite local).
- **Avatares (avisos)**: "Foto guardada neste computador. Abra o lápis para dar nome, escolher mulher ou homem e descrever."
  e "Avatar criado sem foto: o rosto gerado pelo Flow é f…" (explica que o rosto gerado é fase futura).
- **Analisados / Produção (rótulos)**: "ver análise" / "esconder análise"; "Escolher outro viral"; "gerando · cena N/M";
  bullets de análise "com áudio" / "sem faixa de áudio" (vêm dos metadados reais do MP4, não de IA).
- **"✕ Descartar vídeo"** (Produção): **função inexistente no original** — lá o cartão de vídeo tem **"Editar vídeo"** e
  **"Algo deu errado?"**. O clone não implementa nenhum dos dois (o editor é fase futura) e mantém um descarte próprio, com
  2º clique, só para tirar da Produção um vídeo que já terminou/foi cancelado.
- **Lote v1 migrado entra PARADO**: texto do log "Lote de versão anterior atualizado: … Ele fica PARADO — nada é gerado sem você
  pedir…" (ver "Migração de lotes da v1").
- **Casca**: texto do painel "Precisando de ajuda?", do diálogo "CONECTAR O FLOW" (o passo-a-passo agora é o da **nossa**
  extensão: baixar o .zip, `chrome://extensions`, abrir o Flow, "Desligar a simulação e gerar de verdade") e dos painéis
  "Contas Flow"/"Instalar extensão" (os títulos são literais; a frase de status é reescrita — o código
  `EXTENSAO_NAO_INSTALADA; …` é do clone, o original mostra `EXTENSAO_SEM_RESPOSTA; …`); a página `/zerum/extensao`; os
  textos do popup da extensão; as linhas de log da geração real ("começou a gerar de verdade no Flow", cota/pausa,
  "As N cenas foram geradas e baixadas, mas não consegui juntá-las…").

### Migração de lotes da v1 (decisão registrada)

Lotes da versão 1 (estado `preparando`, ou `na_fila` sem vídeos) são **materializados uma única vez no bootstrap** — os
vídeos e cenas são criados — e entram **PARADOS** (`state = parado` e `stop_requested = 1`), **nunca** em `na_fila`. Motivo: a
simulação avança por leitura (`tickBatches`) e rodaria um lote `na_fila` sozinha no primeiro `GET` depois da migração, sem o dono
ter pedido nada. Só **"Continuar de onde parou"** (ou cancelar/descartar) mexe nele. Coberto por teste
(`services.test.ts`: lote v1 `preparando` fica `parado` após vários ticks e só roda depois do `resumeBatch`).

### Divergências que NÃO consegui verificar (preciso de captura na referência)

1. **Cartão de lote em PRODUÇÃO com um lote rodando** (layout, ordem dos botões, "etapa" por vídeo, cenas, "Regerar cena"): só
   havia o estado vazio nos snaps; o cartão foi montado a partir do `zerum-app.js`.
2. **Cartão do plano no DIRETOR** (`requer_confirmacao`): layout/aspecto reais do "Plano" com "Executar N passos".
3. ~~Cartão de viral em ANALISADOS~~ — **resolvido em 24/11** (r10-analisados: miniatura, meta, Gancho/Estrutura, 4 botões).
   Ainda sem captura: o aspecto do botão "Apagar" no 2º clique e o modal de "▶ Assistir".
4. **Lápis e lixeira do avatar** (formulário e confirmação de apagar) e **"Selecionar vários"** em uso: só o estado fechado foi
   capturado. A **grade** foi calibrada em 24/11 (ver "Recon de 24/11"); os botões "Mesma pessoa/Pessoa nova" existem em cada
   cartão mas só mostram o aviso de fase futura.
5. **Aba VÍDEOS com vídeos** (cartões, versões "v2", botão **Editar**) — o **editor "Editar" não foi implementado**; a conta
   capturada tinha 0 vídeos.
6. **⚙**: valor padrão de "altura da legenda" e a aparência de "Ajustes avançados" aberto. (Selects **confirmados no original em
   24/11** e já alinhados no clone — ver "Recon de 24/11".)
7. **Manual**: seletor de cor do balão (não aparece no snap), o que "trocar modelo → clique aqui" realmente abre, e a regra exata
   de "Falta:" para viral/avatar (ver "Recon de 24/11": uma pendência por vez, textos dos extras literais do bundle).
8. ~~Posição do botão "🎬 Diretor"~~ — confirmada em 24/11: primeiro item do conteúdo, depois da barra "Conectar o Flow".
9. **Textos cortados em ~200 caracteres nos snaps** (`…`): fim da mensagem "Assisti o viral … Toque n…", descrição do balão
   ("Vale pros lotes que o Diretor montar a partir …") — completei o que o original tem no `zerum-app.js`/`OptionsCard`; o resto é meu.
10. **Responsivo/largura** dos painéis laterais (usei `26rem`).

## Testes

`npm test` (vitest, **411 testes** em 31 arquivos; mais 4 testes opcionais, em 2 arquivos, que só rodam com as variáveis
abaixo) cobre:

- **App** (`src/**`): regras puras (opções, Diretor, plano, produção com relógio injetado, análise, MP4 incl. metadados, **junção
  de clipes MP4** amostra por amostra, **prompt de cada cena**, zip com CRC, avatar/⚙, Range/Content-Disposition),
  protocolo/broker/pílula, **a ponte** (`BridgeClient`: `postMessage`, timeout de 25 s sem reenvio, ignorar mensagens de
  outra janela/origem; `pickAccount`: troca automática, pausa de cota), **migrações** (v1→v2→v3 com dados) e **serviços sobre
  SQLite real** (conversas, plano→lote, cenas/cancelar/parar/regerar/falha, vídeos/download/zip, virais, avatares, ⚙, e a
  **execução real** em `real-service.test.ts`: modos simulado/real/espera, reserva de cenas, aba líder, resultado, junção,
  cota, retomada, vídeo real sem selo). `no-network.test.ts` varre `src/**` e `next.config.ts` com o parser do TypeScript e
  falha se aparecer import de rede, URL externa, `WebSocket`/`EventSource`/`XMLHttpRequest`/`sendBeacon` ou `fetch` fora do
  `client.ts` — a ponte `postMessage` é o único tráfego permitido.
- **Extensão** (`extensao/test/**`, sem Chrome nem rede): **broker** (máquina de estados, timeout, journal, 429 → 24 h,
  `unknown`, idempotência, *leases*), service worker, relay `postMessage`, worker da aba do Flow, driver sobre uma página
  falsa, **contrato das mensagens nos dois lados** (app TS × extensão JS), **auditoria de rede por AST** da extensão e a
  **cadeia completa em processo** (serviços do servidor + bomba + relay + service worker + worker + Flow falso).
- **Opcionais** (ficam "skipped" sem as variáveis):
  - **smoke HTTP da ponte simulada** contra um `next start` de verdade: `ZERUM_SMOKE_BASE=http://127.0.0.1:3101 npx vitest run extensao/test/smoke-http.test.mjs`;
  - **e2e em navegador real** (Chrome/Edge com a extensão carregada, o app e um **Flow falso em HTTPS** com certificado
    autoassinado): `ZERUM_E2E_CDP` + `ZERUM_E2E_APP` (`extensao/test/e2e-browser.test.mjs`). Nunca fala com o Flow de verdade.

Além dos testes: `tsc --noEmit`, `next build` (feito numa cópia em `/tmp`, para não atrapalhar o `dev` da 3100), smoke HTTP
ponta a ponta (Host falso 403, CSRF 403, upload válido 201, corrida de uploads idênticos, plano→confirmação→lote→PRONTO,
download/Range/zip, falha→regerar, cancelar, avatares, ⚙; ponte: status sem extensão, `.zip` da extensão) e passadas no
navegador (Diretor com viral → corrigir leitura → plano → Executar → Produção; Manual; Analisados; Vídeos; painéis Avatares e
⚙; e, no e2e, o Flow falso gerando um vídeo de 2 cenas que vira **um** MP4 juntado, e a cota 429 pausando a conta).

## Próximos passos / o que ficou pendente

1. **Observar o Flow real** e ajustar [`extensao/drivers/selectors.js`](extensao/drivers/selectors.js) (checklist em
   [`extensao/drivers/LEIAME.md`](extensao/drivers/LEIAME.md)). Até lá, a primeira geração real deve ser **supervisionada**
   (1 vídeo curto, com o Diagnóstico do Flow já verde). Nenhuma geração real foi feita nesta entrega.
2. Escolha de **modelo** do Flow na interface (a extensão já aceita `model`) e **créditos**/estimativa de gasto antes de
   executar o plano.
3. Gerar **imagem/rosto** pelo Flow (hoje só vídeo), leitura do viral e roteiro por IA, editor de vídeo.
4. Legenda e balão gravados no MP4 (hoje o vídeo real é o clipe do Flow, juntado).
5. Empacotar a extensão para a Chrome Web Store (hoje é "carregar sem compactação").
