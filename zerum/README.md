# Zerum 001 — clone local (fase 2: fluxos completos)

Réplica local do **Zerum**, o estúdio da 001.community (`https://001.community/zerum`, embutido por iframe em
`/zerum/index.html`). Este módulo é um **app separado** dentro do repositório do ColdClick; não importa nem altera o
Estúdio Criativo (`src/`, `data/`, `reference/`).

> **Requisito central do dono: SEM LOGIN, SEM ASSINATURA, SEM ANTIGRAVITY.** Abre e usa. Nada neste módulo chama a
> internet. **Gerar vídeo/imagem DE VERDADE é a fase futura** (executor via extensão do Chrome): nesta fase todos os fluxos
> e estados existem e funcionam localmente até o ponto do envio, e a geração é **simulada e sempre rotulada como simulação**
> (ver "Simulação" abaixo).

## O que existe (fluxos de ponta a ponta)

| Fluxo | Como funciona nesta fase |
| --- | --- |
| **Conversas** | criar, renomear, trocar, apagar (com eventos); histórico de mensagens do Diretor persistido; modos viral/ideia |
| **Viral** | upload MP4 (≤ 60 MB, validado por `ftyp`, dedupe sha256) → **leitura local**: duração, dimensões e faixas de áudio/vídeo lidas **do próprio arquivo** (parser de `moov`/`mvhd`/`tkhd`) → aparece em **ANALISADOS**. Gancho/estrutura/falas ficam **vazios** (não há IA) até o usuário preencher em **"A leitura errou? Corrigir"** (formulário "Alterar análise": pessoas, tela, cenas, fala, estrutura, enquadramento; "voltar à original") |
| **Diretor** | pedido em linguagem natural → **plano com passos e `requer_confirmacao`** ("o Diretor mostra os passos, você confirma, e a ferramenta executa") → **Executar N passos** → lote em PRODUÇÃO. Refinar ("faz 20", "troca a abertura") substitui o plano pendente. "Aprovar tudo automaticamente" (⚙) executa sem clique. Interpretação por palavras-chave (quantidade, igual/adaptar, variação, idioma, palavra, "avatares novos") — **sem IA** |
| **Manual** | os 4 passos da aba (1 qual viral · 2 igual ou adaptado + variação · 3 quem aparece e quantos · 4 gerar) com "PEDIDO", nome do lote, balão, idioma, observações, "Falta:" e LOG; **GERAR** cria o lote e abre a Produção |
| **Produção** | cartões de lote → vídeos → **cenas** com progresso, estados `na fila / gerando / PRONTO / FALHOU / cancelado / parado`, **Parar depois dos atuais**, **Continuar de onde parou**, **✕ Cancelar agora (2º clique)**, **↻ Regerar todas as cenas com falha**, **Baixar todos os prontos (zip)**, **✓ Aprovar lote → Vídeos**, **✕ Descartar lote (2º clique)**, log em tempo real (eventos persistidos) |
| **Vídeos** | "MEUS VÍDEOS": só os prontos, por lote (mais novo primeiro), com player e **⬇ Baixar MP4** (`Nome_12345.mp4`, código diferente em cada vídeo do lote) |
| **Avatares** | painel lateral com biblioteca: foto (JPG/PNG/WEBP ≤ 20 MB validada pelo conteúdo, `data/avatares/<sha256>.<ext>`) ou "Sem foto", criar/editar (lápis)/remover com diálogo de confirmação, **Selecionar vários** (apagar com 2º clique), **⬇ Baixar todos (zip)**, ✨ Gerar 1/4 (cartões sem foto) |
| **⚙ Configuração** | painel lateral conforme o original: Geração (simultâneos, imagem, cópia no Flow), **Legenda** (cor, ajustes avançados, ★ padrão), **Aprovação**, Seus limites, chave própria — tudo **persistido em SQLite** |
| **Ponte site⇄extensão** | **apenas interfaces** em `src/lib/bridge/` (protocolo `zre`, broker, executor nulo) — inalterado |

Fora de escopo (fase futura): gerar vídeo/imagem de verdade, extensão do Chrome, leitura do viral por IA, roteirização por
IA, "Editar" (editor de vídeo), variações de rosto ("Mesma pessoa, outro visual", "Pessoa nova parecida"), galeria do Flow.

## Simulação (leia antes de confiar num "PRONTO")

Sem executor real, o que faz um vídeo "ficar pronto" é o **executor simulado** (⚙ → *Simulação local da geração*, **ligado
por padrão**):

- cada **cena** leva `sceneMs` (2,5 s; `ZERUM_SIM_SCENE_MS` muda) e o número de cenas vem da duração do viral (clipes de 8 s;
  sem viral, 4);
- respeita **"Vídeos simultâneos"** do ⚙;
- o arquivo entregue em **⬇ Baixar MP4** é **uma cópia do viral** (ou, num lote sem viral, um clipe de teste de 15 KB embutido) —
  **não é uma geração**. Todo vídeo desse tipo mostra o selo **SIMULADO** e o log do lote diz isso;
- o avanço é **por leitura** (`tickBatches`): cada `GET` de Produção/Vídeos avança o relógio; não há timers nem processo em
  segundo plano, e o estado fica em SQLite (reiniciar o servidor não perde nada);
- **falhas**: a única falha "real" é o arquivo do viral ter sumido do disco (o vídeo falha com a causa). Para exercitar o
  estado `FALHOU` e o *Regerar*, o ⚙ tem **"Teste de falha: todo N-ésimo vídeo falha"** (0 = desligado);
- **simulação desligada**: o lote fica `na fila` esperando o executor (fase futura) — nada avança.

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
- `domain/` (puro, testado): opções do vídeo, Diretor (quantidade, título), **plano** (`plan.ts`: interpretação, passos),
  **produção** (`production.ts`: máquina de estados com relógio injetado), análise do viral, parser de MP4, foto do avatar, ⚙,
  **zip** em streaming.
- As **cenas não têm linha própria**: o estado de cada uma deriva de `scenes_done` / `fail_scene` do vídeo.
- `bridge/` (interfaces): `protocol.ts` (mensagens `zre`), `broker.ts`, `status.ts` (`FlowExecutor`, `NullFlowExecutor`).
- API nova: `/plans/:id/confirm|cancel`, `/virals/:id/analysis[/revert]`, `/virals/:id/video` (Range), `/avatars/*` (foto,
  from-photo, generate, bulk-delete, zip), `/batches/:id/{stop,resume,retry,approve,cancel,zip}`, `/videos`,
  `/videos/:id/{download,retry}`, `/log`, `/settings/key`.

## Travas do original removidas

| Trava no original | No clone |
| --- | --- |
| **Sessão 001.community** (`na("ingresso", …)`, 401, bloqueio de acesso) | **Não existe.** Proteção só de "este computador" (`127.0.0.1` + Host/origem) |
| **Assinatura** (app desktop "entre com o e-mail da sua assinatura") | Faixa "NOVO ZERUM — baixar instalador" **não reproduzida** (propaganda do instalador pago) |
| **Antigravity** (`PRECISA_CONECTAR`, cota por modelo) | **Não existe.** Sem IA externa; o Diretor é local. No ⚙ somem a linha "Antigravity / Desconectar", **INTELIGÊNCIA** (Gemini/Claude) e as cotas **ANTIGRAVITY** de "SEUS LIMITES" |
| **Código de membro `ZR-…`** / MCP | Removido (`connect` fora de `BRIDGE_ACTIONS`). A seção **"CONECTAR A SUA IA (MCP)"** do ⚙ **não foi reproduzida**: depende do servidor da 001 e o próprio original diz que está desligado |
| **Extensão no flow.google.com** exigida | Não exigida para usar o app (o banner diz "Pode usar o Zerum normalmente") |
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

### Conferência item-a-item (script `grep` contra os snaps)

Foram feitas **584 verificações** (literais extraídos dos 7 snaps) e procurados no código (`src/**`, normalizando espaços/JSX): Manual 98 · Produção
37 · Analisados 31 · Vídeos 35 · Avatares 103 · ⚙ 195 · Diretor/ideia 85. O que **não** aparece como string contígua:

- **equivalentes** (o texto está no código quebrado em partes/CSS): `GERADOR E EDITOR AUTOMÁTICO 001` e `NADA EM PRODUÇÃO AGORA.`
  (maiúsculas por CSS), `(5)` (contador dinâmico), `🎲 3 avatares novos`, `Balão COMMENT: DESLIGADO`, `· 🎬`, `· 32 s · lido ✓`,
  `Cor <nome>` (aria-label gerado), `5 palavras`, o resumo `PEDIDO · …` (montado; coberto por teste com a frase literal);
- **da casca da 001, não do Zerum**: `🖥️ NOVO ZERUM…`, `Avisos, alt+T`, menu lateral, usuário logado;
- **dados de exemplo da conta capturada**: viral `REF_IA_76M_BEBIDA_32s`, avatares `PF 1`/`PERFIL n`, e-mail, endereço MCP, horários;
- **omitidos de propósito** (Antigravity/MCP — ver "Travas"): `Desconectar`, **INTELIGÊNCIA** + o texto do Gemini, cotas
  **ANTIGRAVITY** ("Gemini 100% · volta 24/11 às 03:03"), toda a seção **MCP**;
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
  "Plano cancelado…"; a frase final da simulação ("Nesta versão local a geração é simulada…").
- **Plano**: os textos de cada passo; o selo "gasta crédito"; "✓ executado · abrir Produção"; "plano cancelado"; "substituído por
  um plano mais novo". (Literais do original: "Plano", "(você confirma; o que gasta crédito está marcado):", "Executar",
  "Executar N passos", "Fechado. Confira o plano aqui embaixo e clique em … — ou diga o que quer mudar.", "Executando o que
  você confirmou, na ordem…", "Feito: … Acompanhe no painel Produção; cada vídeo pronto entra em Vídeos.")
- **Produção**: selo **SIMULADO**; faixa de cenas; barra de progresso; "ver log / esconder log"; "✕ Descartar vídeo"; "terminou
  com falha"; todas as linhas de log do lote; os textos-padrão das cenas ("Cena k: fala nova sobre o mesmo assunto (o roteiro é
  escrito pela IA do Diretor — fase futura).", "Cena k: mesma fala do viral (a transcrição está vazia…)"); mensagem de falha real
  (arquivo do viral sumiu). (Literais do original: "Parar depois dos atuais", "Parando após os atuais…", "✕ Cancelar agora" /
  `✕ Confirmar: cancelar "…"?`, "↻ Regerar todas as cenas com falha (N)", "Baixar todos os prontos (N)", "✓ Aprovar lote →
  Vídeos", "✕ Descartar lote", "⬇ Baixar MP4", "↻ Tentar de novo", o aviso de 2º clique, a mensagem "O Google não conseguiu terminar
  esta cena…".)
- **Manual**: itens extras de "Falta:" ("Suba o viral (passo 1).", "Marque quem aparece (passo 3)."); "Guardando o viral…". (Os
  chips "usar este" / "✓ base do lote" são literais do `zerum-app.js`.)
- **Avatares**: avisos de "fase futura" (variações, galeria do Flow, ✨ Gerar sem foto); "Sem foto"; "SEXO?"; "Nenhum avatar ainda.
  Mande a sua foto, gere do zero ou preencha à mão."; diálogo de apagar ("Apagar "X"? A foto sai só deste computador…") e os
  títulos/rótulos do formulário do lápis; "Escolha se a pessoa é mulher ou homem…" e "Isso não é uma foto. Mande JPG, PNG ou WEBP."
  (**adaptados**: o original aceita HEIC; aqui não).
- **⚙**: linha "Zerum local — sem login · sem assinatura · sem Antigravity"; bloco "Simulação local da geração" e "Teste de falha";
  as linhas locais de "SEUS LIMITES" (VIRAL, LOTE, ROLETA); o texto da chave ("guardada · ••••1234", "Só pra quem ainda usa o modo
  antigo… Aqui ela só fica guardada neste computador — não é testada nem enviada"); "Padrão salvo: …". (Título "Diretor (modo
  antigo, chave própria)", "Apagar chave" e "Chave apagada." são literais do `zerum-app.js`.)
- **Vídeos / Analisados**: selo SIMULADO; "Leitura local: só os dados do arquivo (corrija no Diretor para preencher)."
- **Casca**: texto do painel "Precisando de ajuda?", do diálogo "CONECTAR O FLOW" (passo-a-passo trocado por "fase futura") e
  dos painéis "Contas Flow"/"Instalar extensão" (os títulos são literais; a frase de status é reescrita).

### Divergências que NÃO consegui verificar (preciso de captura na referência)

1. **Cartão de lote em PRODUÇÃO com um lote rodando** (layout, ordem dos botões, "etapa" por vídeo, cenas, "Regerar cena"): só
   havia o estado vazio nos snaps; o cartão foi montado a partir do `zerum-app.js`.
2. **Cartão do plano no DIRETOR** (`requer_confirmacao`): layout/aspecto reais do "Plano" com "Executar N passos".
3. **Cartão de viral em ANALISADOS com dados** (miniatura, "Usar no Diretor", ▶ Assistir, ⬇ Baixar): só o estado "carregando…".
4. **Lápis e lixeira do avatar** (formulário e confirmação de apagar), **"Mesma pessoa, outro visual" / "Pessoa nova parecida"**,
   **"Selecionar vários"** em uso, e a **grade** (o original mostra ~4 cartões estreitos por linha; o clone usa 2).
5. **Aba VÍDEOS com vídeos** (cartões, versões "v2", botão **Editar**) — o **editor "Editar" não foi implementado**.
6. **⚙**: opções reais dos selects "Vídeos simultâneos" (assumi 1–4) e "Imagem" (3 modelos vindos do app.js), valor padrão de
   "altura da legenda", e a aparência de "Ajustes avançados" aberto.
7. **Manual**: seletor de cor do balão (não aparece no snap), o que "trocar modelo → clique aqui" realmente abre, e a regra exata
   de "Falta:" (no snap só aparece a palavra, mesmo sem viral/avatar).
8. **Posição/papel do botão "🎬 Diretor"** nas abas fora do Diretor (aparece no snap, sem captura visual).
9. **Textos cortados em ~200 caracteres nos snaps** (`…`): fim da mensagem "Assisti o viral … Toque n…", descrição do balão
   ("Vale pros lotes que o Diretor montar a partir …") — completei o que o original tem no `zerum-app.js`/`OptionsCard`; o resto é meu.
10. **Responsivo/largura** dos painéis laterais (usei `26rem`).

## Testes

`npm test` (vitest, **162 testes**, 14 arquivos): regras puras (opções, Diretor, plano, produção com relógio injetado, análise,
MP4 incl. metadados, zip com CRC, avatar/⚙, Range/Content-Disposition), protocolo/broker/pílula, **migrações** (inclui v1→v2 com
dados) e **serviços sobre SQLite real** (conversas, plano→lote, cenas/cancelar/parar/regerar/falha, vídeos/download/zip, virais,
avatares, ⚙). `no-network.test.ts` varre `src/**` e `next.config.ts` com o parser do TypeScript e falha se aparecer import de
rede, URL externa, `WebSocket`/`EventSource`/`XMLHttpRequest`/`sendBeacon` ou `fetch` fora do `client.ts`.

Além dos testes: `tsc --noEmit`, `next build`, smoke HTTP ponta a ponta (Host falso 403, CSRF 403, upload válido 201, corrida de
uploads idênticos, plano→confirmação→lote→PRONTO, download/Range/zip, falha→regerar, cancelar, avatares, ⚙) e uma passada no
navegador (Diretor com viral → corrigir leitura → plano → Executar → Produção; Manual; Analisados; Vídeos; painéis Avatares e ⚙).

## Fase futura: executor / extensão

Desenhado, **não implementado** (`src/lib/bridge/`), a partir da extensão Zerum 0.4.18: protocolo `window.postMessage`
(`zre`), timeout 25 s sem reenvio, broker `queued → dispatched → accepted → completed/failed/unknown`, cota (429 pausa 24 h),
`FlowExecutor` com `NullFlowExecutor` hoje e `setExecutor()` como ponto de injeção. O **executor simulado** desta fase
(`production-service.ts`/`domain/production.ts`) ocupa o lugar do executor real e é **o ponto a substituir**: o resto
(plano, lote, vídeos, cenas, log, download) já está pronto para receber o resultado real.
