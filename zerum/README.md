# Zerum 001 — clone local (fundação)

Réplica local do **Zerum**, o estúdio da 001.community (`https://001.community/zerum`, embutido por iframe em
`/zerum/index.html`). Este módulo é um **app separado** dentro do repositório do ColdClick; não importa nem altera o
Estúdio Criativo (`src/`, `data/`, `reference/`).

> **Requisito central do dono: SEM LOGIN, SEM ASSINATURA, SEM ANTIGRAVITY.** Abre e usa. Nada neste módulo chama a
> internet; a geração real de vídeo é a **fase futura** (executor via extensão).

## Escopo desta rodada

| Feito | Observação |
| --- | --- |
| Tela principal 1:1 (tema `#0a0a0b`, Google Sans, Material Symbols) | Abas DIRETOR / MANUAL / PRODUÇÃO / ANALISADOS / VÍDEOS, botões Avatares e ⚙, banner "Conectar o Flow", painel CONVERSAS, "Como criar", dropzone, "Opções do vídeo", idioma, composer, pílula de ponte, modal "CONECTAR O FLOW", painéis "Contas Flow · candidata" / "Instalar extensão Zerum", "Precisando de ajuda?" e "Sugestão ou bug" |
| Conversas persistidas (SQLite) | criar, renomear, apagar, modo viral/ideia, opções por conversa, histórico de mensagens |
| Upload de viral **local** | MP4 ≤ 60 MB validado pelo conteúdo (`ftyp`), dedupe por sha256, gravado em `data/virais/<hash>.mp4` |
| Diretor **local e determinístico** | interpreta "faz 20", "3 vídeos"… e cria um **lote em `preparando`** com log; não há IA |
| Produção / Analisados / Vídeos | lotes com log local e cancelar/apagar; Analisados lista os virais; Vídeos só tem estado vazio (nada é gerado) |
| Ponte site⇄extensão | **apenas interfaces** em `src/lib/bridge/` (protocolo `zre`, broker, executor nulo) |

Fora de escopo (fase futura): gerar vídeo/imagem, extensão do Chrome, "leitura" do viral pelo Diretor (IA), portão de
conferência de cenas, avatares com foto no Flow.

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

- **Porta própria: 3100** (o Estúdio Criativo usa 3000) e **bind `127.0.0.1`** nos scripts (`-H 127.0.0.1 -p 3100`).
- Todas as rotas ficam sob **`/zerum`** (`basePath`): página `/zerum`, API `/zerum/api/*`.
- Dados em `zerum/data/` (ignorado pelo git): banco **`zerum.db`** e pasta **`virais/`**. Troque com `ZERUM_DATA_DIR`
  (ver `.env.example`; tudo é opcional).
- Defesa de servidor local (`src/middleware.ts`): allowlist de `Host` (DNS rebinding) e checagem de origem em
  POST/PUT/PATCH/DELETE (CSRF); corpos JSON exigem `application/json`.
- Node ≥ 20.9 (testado em 24). `better-sqlite3` baixa o binário pré-compilado durante o `npm install`; fora isso, zero rede.

### Por que um app separado (e não rotas dentro do `src/` do irmão)

Porta e processo próprios, dependências e banco próprios, e zero risco de regressão no Estúdio Criativo (o irmão
continua `npm run dev` na raiz, intacto). Única alteração fora de `zerum/`: `"zerum"` foi acrescentado ao `exclude` do
`tsconfig.json` da raiz, senão o `tsc` do irmão tentava compilar este app com o alias `@/*` dele.

## Arquitetura (padrões do ColdClick, sem importar código dele)

```
rota (src/app/api/**)  →  serviço (src/lib/services/*)  →  repositório (src/lib/repo/*)  →  SQLite
                              ↑ regras puras: src/lib/domain/*        zod = fonte única: src/lib/schemas.ts
```

- Migrações versionadas em `src/lib/migrations.ts` (append-only) aplicadas por `migrate.ts` com `BEGIN IMMEDIATE` e
  `foreign_key_check`; versão em `PRAGMA user_version`.
- `domain/` (puro, testado): opções do vídeo (cores `#FFC400`…, hex, contraste, nome do lote), Diretor (quantidade,
  título da conversa, placeholder), validação de MP4.
- `bridge/` (interfaces): `protocol.ts` (mensagens `zre`), `broker.ts` (máquina de estados e política de cota),
  `status.ts` (`FlowExecutor`, `NullFlowExecutor`, rótulo da pílula).

## Travas do original removidas

| Trava no original | No clone |
| --- | --- |
| **Sessão 001.community** — `na("ingresso", …)`, 401 "Não consegui confirmar o seu acesso agora", bloqueio "O seu acesso ao Zerum está bloqueado…" | **Não existe.** Nenhuma rota exige sessão; sem cookie, sem e-mail de assinatura. A proteção é só "este computador" (`127.0.0.1` + checagem de Host/origem). |
| **Assinatura** (app desktop "entre com o e-mail da sua assinatura da 001") | Faixa "NOVO ZERUM — baixar instalador" **não foi reproduzida** (é propaganda do instalador pago). |
| **Antigravity** — servidor responde `PRECISA_CONECTAR` até parear por link + código; cota por modelo (`agy/status`, escada de fallback) | **Não existe.** Sem pareamento, sem cota de modelo e sem IA externa: o Diretor é local. O ⚙ mostra "Não existe" para essa trava. |
| **Código de membro `ZR-XXXX-XXXX-XXXX`** — ação `connect` da ponte trocava a sessão logada pelo código | Removida de `BRIDGE_ACTIONS` (há teste). Pareamento futuro será local. |
| **Extensão no flow.google.com** exigida para gerar | Não exigida para usar o app. Só a geração real (fase futura) dependerá dela; o banner "Conectar o Flow" diz "Pode usar o Zerum normalmente". |
| Endpoints do servidor da 001 (`memoria`, `video`, `foto`, `caixa`, `leitura`, `montagem`, `conversas`, `diretor/`, `modelar`, `agy/…`) | Substituídos por rotas locais `/zerum/api/*` sobre SQLite. |
| "Sugestão ou bug" enviava ao servidor da 001 | Só grava em `feedback` no `zerum.db`. |
| Fontes/React/Tailwind por CDN (`fonts.googleapis.com`, `esm.sh`, `jsdelivr`) | Self-hosted via npm (`@fontsource/*`, Next, Tailwind compilado). Zero requisição externa (verificado no navegador). |
| Portão de confirmação de cenas (`jev_portao_prompts`) | Não replicado: sem geração, não há cenas. Entra com o executor. |

## Fidelidade visual e textos

Fonte: `reference/zerum-001/001-zerum.snap.txt`, `zerum-index.html` (CSS/markup da casca) e leitura do `zerum-app.js`
(só estudo — nenhum código copiado; o JSX/CSS foi reescrito). Textos literais, incluindo "Sua palavra da automação",
"ex.: Umbigo", "MP4 até 60 MB · o Diretor assiste e copia a estrutura", cores `#FFC400 / #22C55E / #EF4444 / #3B82F6 /
#F65CB4 / #FF7A00 / #FFFFFF / #141414`, "Pedido ao Diretor", etc.

Diferenças deliberadas / observações:

- **Pílula de ponte:** o `zerum-index.html` escreve `○ sem Flow · clique pra reconectar` (maiúsculo por CSS); o snap
  da build com painel de contas mostra `○ CONTAS FLOW`. O pedido do dono cita "❌ sem Flow — clique pra reconectar".
  Usei o texto do HTML de referência (glifo `○`, não ❌). Para a variante do snap: `PILL_MODE = 'contas'` em
  `src/components/FloatingDock.tsx`.
- **Menu lateral do painel 001** (Início, Produtos, Financeiro…) não faz parte do Zerum (é a casca da 001.community);
  a rota `/zerum` renderiza só o conteúdo do iframe.
- **Fonte:** o npm não tem `Google Sans Text`; usa-se `@fontsource/google-sans` na pilha `'Google Sans Text', 'Google Sans', system-ui`
  (a mesma declarada pelo original).
- **Logo "001"** é um chip em texto (não foram copiados os PNGs da marca); o "Zerinho" do botão de ajuda é um "Z" em círculo.
- **Textos sem fonte literal** (escritos para este clone): estado vazio da aba VÍDEOS, aba MANUAL, aba AVATARES,
  painel ⚙, diálogo "CONECTAR O FLOW" (reaproveita título, status, checklist e `detalhe:` do original; o passo-a-passo
  de instalar a extensão foi trocado por "fase futura"), resposta do Diretor local.
- Produção, Analisados e o seletor de virais usam os textos literais do original ("Nada em produção agora.",
  "Nenhum viral analisado ainda…", "Nenhum viral aqui ainda…", "Nada com essa busca.").

## Fase futura: executor / extensão

Desenhado, **não implementado** (`src/lib/bridge/`), a partir da extensão Zerum 0.4.18:

- **Protocolo** `window.postMessage`: `{zre:'request', id, action, payload}` → `{zre:'response', id, result|error}`;
  push `flow-health` / `flow-credits`; só `source===window` e mesma origem; `id` 1–128 chars.
- **Timeout 25 s** → `EXTENSAO_SEM_RESPOSTA; pedido preservado, não gerar outra vez` — o pedido **nunca** é reenviado;
  reconcilia (leitura) em vez de repetir o submit.
- **Broker** `queued → dispatched → accepted → completed/failed/unknown`; `unknown` só sai por reconciliação; só `queued`
  pode ser reenviado; journal em `chrome.storage.local`; chave de idempotência por job/contexto/comando/args.
- **Cota:** 429/QUOTA/COTA pausa 24 h; INCOMUM/UNUSUAL/RESOURCE_EXHAUSTED pausa 5 min; sem troca de conta/modelo para contornar.
- **`FlowExecutor`** (`status/accounts/submit/get/reconcile`) com `NullFlowExecutor` hoje; `setExecutor()` em
  `services/bridge-service.ts` é o ponto de injeção. Lotes já nascem com os estados `na_fila/rodando/pronto/falhou` no
  `CHECK` da tabela, para a fase do executor não reconstruir o schema.
- Próximos passos: pareamento **local** (token gerado pelo app, sem código 001), extensão MV3 própria, executor real,
  leitura do viral e roteirização (decisão de IA em aberto), portão de conferência de cenas.

## Testes

`npm test` (vitest, 76 testes): regras puras (opções, Diretor, MP4), protocolo/broker/pílula, migrações (SQLite em
memória) e serviços sobre um SQLite real em pasta temporária — inclusive um teste que varre o código e falha se
aparecer import de rede, URL externa ou `fetch` fora do `client.ts`.
