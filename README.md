# Estúdio Criativo — réplica local (ColdClick Affiliates)

Réplica funcional do **Estúdio Criativo do ColdClick Affiliates**, feita para rodar localmente, ser alterada com o Claude
e ter as mudanças repassadas aos devs da plataforma original. O código é novo (nada proprietário foi copiado) e a UI é em PT-BR.

> **Estado atual (fase 2 — fidelidade visual):** wizard de novo trabalho, fila de trabalhos com worker em background,
> biblioteca de avatares, Contas Flow (pareamento de Chrome + rotação), Chaves Gemini e configurações, com visual e textos
> alinhados à plataforma de referência (`reference/`). **A geração real ainda não existe:** o worker produz *placeholders*
> (SVG). A automação do Flow pela extensão é a próxima fase.

---

## Como rodar no Mac

Requisitos: **Node.js 20.9+** (recomendado 22 — há um `.nvmrc`).

```bash
npm install
npm run dev        # http://localhost:3000
```

O banco SQLite e a pasta de arquivos são criados em `./data/` na primeira execução (3 avatares de exemplo incluídos).
Opcional: `ffmpeg` (`brew install ffmpeg`) para transcrever vídeos grandes (o app extrai só o áudio antes de enviar ao Whisper).

Outros comandos: `npm run build && npm start`, `npm run typecheck`, `npm test`.
Variáveis (todas opcionais, ver `.env.example`): `COLDCLICK_DATA_DIR`, `COLDCLICK_SECRET_KEY`, `COLDCLICK_SIM_FAILURE_RATE`,
`COLDCLICK_SIM_SPEED`, `COLDCLICK_REQUIRE_FLOW`.

> ⚠️ Não rode `next build` na mesma pasta enquanto o `next dev` estiver ligado: os dois escrevem em `.next/`. Se isso
> acontecer, pare o dev, apague `.next/` e suba de novo.

---

## Telas e rotas

| Rota | Tela (rótulos idênticos à plataforma de referência) |
| --- | --- |
| `/trabalhos` | **Trabalhos**: lista única com status, fase, "N de M vídeos concluídos · F falhas", barra de progresso, busca, filtros e "Abrir geração". Estado de carregamento com skeletons. |
| `/trabalhos/[id]` | Detalhe do trabalho: progresso, galeria, configuração; cancelar / reexecutar falhas / excluir. |
| `/novo-trabalho` | **Novo trabalho** (4 etapas: Vídeo · Roteiro · Personalização · Revisão), cartão "Conexão do Google Flow", "Armazenamento da conta", painel **Resumo do trabalho** (nome, modelo, resolução) e modal "Confirmar gerações reais no Flow". |
| `/avatares` | **Biblioteca de avatares** (busca, abas, paginação, adicionar/editar/remover com fotos). |
| `/contas-flow` | **Contas Flow**: duas conexões, Conector do Chrome (instalar, parear, navegadores pareados), contas do Google Flow com prioridade, saldo, "Usar na rotação" e regras de rotação (+ simulador). |
| `/chaves-gemini` | **Chaves Gemini**: cadastro em lote (1 por linha, até 10) e "Ordem de tentativa". |
| `/configuracoes` | *Extra desta réplica*: Whisper, modelo Gemini e pasta de armazenamento (menu do usuário, canto superior direito). |
| `/plataforma/*` | Páginas explicativas para Painel, Ofertas, Vendas etc. (fora do escopo do estúdio). |

Rotas antigas: `/gerador` redireciona para `/contas-flow`.

---

## Arquitetura (camadas)

```
rota (src/app/api/**)  →  serviço (src/lib/services/**)  →  repositório (src/lib/repo/**)  →  SQLite
   fina: valida (zod)      regras de negócio, transações,        só SQL, sem regra, sem arquivo
   e serializa             arquivos, criptografia
```

- **Rotas** (`src/app/api`): `api()` (em `lib/http.ts`) garante o bootstrap, valida o corpo com os esquemas de `lib/schemas.ts`
  e converte `AppError` (framework-free, `lib/errors.ts`) em `{ error }` com o status certo. Erros inesperados viram 500 genérico.
- **Serviços** (`lib/services`): `job-service`, `job-runner` (máquina de estados da fila), `video-service`, `avatar-service`,
  `account-service`, `gemini-key-service`, `extension-service`, `settings-service`, `bootstrap`. Usam `transaction()` (`lib/db.ts`)
  quando uma regra toca mais de uma tabela.
- **Repositórios** (`lib/repo`): consultas e atualizações, tipadas por linha (`*Row`). Sem validação, sem arquivos.
- **Regras puras** (`lib/rotation.ts`, `lib/estimate.ts`, `lib/catalog.ts`): sem I/O, testadas (`npm test`).
- **UI**: `components/ui.tsx` (primitivos), `components/shell/AppShell.tsx` (sidebar 256px, topbar 72px), páginas por pasta.
  Server Components **não** podem importar utilitários de arquivos `'use client'` (use `lib/cn.ts`).

### Banco de dados e migrações

`src/lib/migrations.ts` — lista de migrações aplicadas uma vez, em ordem (`PRAGMA user_version`); para evoluir, **acrescente** um item.
- **v1**: schema inicial.
- **v2**: prioridade em contas/chaves; segredos de chaves Gemini criptografados; remoção de colunas derivadas
  (`jobs.planned_*`) e inativas (`gemini_keys.enabled/cooldown_until`); `extension_browsers` + `pairing_codes` (vários navegadores).
- Dados legados em texto puro (chaves Gemini/Whisper) são criptografados no bootstrap.

### Segredos

Chaves de API são guardadas **criptografadas (AES-256-GCM)**. A chave mestra vem de `COLDCLICK_SECRET_KEY` ou de
`data/.secret.key` (gerada na 1ª execução). Protege contra vazamento do `.db` isolado — em produção, use um KMS.
O navegador só recebe máscaras (`••••nzeQ`). Tokens da extensão: só o hash SHA-256 é guardado.

### Worker e ciclo de vida de um trabalho

`instrumentation.ts` inicia um loop de 1 s (`lib/worker.ts`) que chama `runTick()` (`services/job-runner.ts`):
um trabalho por vez, até 3 itens simultâneos; cada variação = 1 imagem-base + 1 vídeo (o vídeo só inicia com a imagem pronta).

```
pending ─▶ running ─▶ done | pending (nova tentativa) | failed (3 tentativas ou teto de gerações)
trabalho: queued ▶ running ▶ completed | partial | failed | cancelled
```

Teto de gerações = base + folga (`estimate.ts`, calibrada para "20 variações → até 62"). "N falhas" = tentativas que falharam.
"Reexecutar falhas" dá tentativas novas só aos itens que falharam e amplia o teto.

### Regras de rotação (iguais às da referência)

- **Contas Flow**: a **ordem de prioridade** define a conta usada primeiro; quando ela esgota a cota, a próxima assume. Só entra na
  rotação conta ativa ("Usar na rotação") com **≥ 40 créditos**; **até 2 vídeos e 2 imagens por conta por ciclo**; esgotadas as cotas,
  começa um novo ciclo. `acquireAccount()` reserva a conta de forma atômica (fase 2 a usará).
- **Chaves Gemini**: sempre começa pela **primeira**; só avança para a próxima após rejeição **definitiva** (400/401/403/429).
  Timeout/erro de rede não trocam de chave (evita cobrança duplicada). A próxima geração recomeça pela primeira.
- Modelos de vídeo: Veo 3.1 - Fast / Fast [Lower Priority] / Lite / Omni 1.1 Flash / Veo 3.1 - Quality (padrão: Lite).
  **360p só existe no Omni 1.1 Flash** (validado no cliente e no servidor).

### Extensão Chrome

Pareamento de **vários** navegadores: nome do Chrome → código de uso único (10 min) → token. A extensão envia heartbeat
(`version`, `flowSessionActive`, `flowAccountEmail`). Detalhes em [`extension/README.md`](extension/README.md).
`GET /api/extension/download` entrega a pasta `extension/` em ZIP.

### Segurança

Importação por URL bloqueia redes internas (SSRF) e revalida redirecionamentos; arquivos servidos com CSP `sandbox`;
limite global de tentativas erradas no pareamento; sem autenticação de usuário (app local).

---

## Fidelidade visual (`reference/`)

`reference/*.json` (estilos computados) e `reference/*.snap.txt` (textos/hierarquia) vieram da plataforma de referência.
Os tokens do tema estão em `src/app/globals.css` + `tailwind.config.ts` com os **valores exatos** (`--background #080c15`,
`--card #0d1422`, `--sidebar #0b1323`, `--primary #2b6bff`, `--border #24324a`, `--destructive #f0555a`, `--radius 12px`, fonte Inter 14px).
O tema **claro** não existe nas capturas: a paleta clara é estimada.

## Roadmap

- **Fase 3 — Automação real do Flow**: orquestrador (prompts com Gemini + `acquireGeminiKey`), `acquireAccount` no executor,
  `content.js` da extensão (plano no topo do arquivo), recebimento de arquivos/créditos, custo real por modelo/resolução.
- **Pendências de fidelidade**: etapas 2–4 do wizard só têm os textos presentes nos dumps (`reference/wizard.json`);
  "Tags/Etiquetas", avatares globais/inativos e vários avatares por trabalho existem só na plataforma original.
