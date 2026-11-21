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
npm run dev        # http://127.0.0.1:3000  (também responde em http://localhost:3000)
```

`dev` e `start` já sobem com `-H 127.0.0.1`: o servidor **só aceita conexões da própria máquina**. Para acessar de outro
aparelho da rede, rode `npx next dev -H 0.0.0.0` **e** liste o host em `COLDCLICK_ALLOWED_HOSTS` (ver "Segurança").

O banco SQLite e a pasta de arquivos são criados em `./data/` na primeira execução (3 avatares de exemplo + 1 global incluídos).
Opcional: `ffmpeg` (`brew install ffmpeg`) para transcrever vídeos grandes (o app extrai só o áudio antes de enviar ao Whisper).

Outros comandos: `npm run build && npm start`, `npm run typecheck`, `npm test`.
Variáveis (todas opcionais, ver `.env.example`): `COLDCLICK_DATA_DIR`, `COLDCLICK_SECRET_KEY`, `COLDCLICK_SIM_FAILURE_RATE`,
`COLDCLICK_SIM_SPEED`, `COLDCLICK_REQUIRE_FLOW`, `COLDCLICK_ALLOWED_HOSTS`.

> ⚠️ Não rode `next build` na mesma pasta enquanto o `next dev` estiver ligado: os dois escrevem em `.next/`. Se isso
> acontecer, pare o dev, apague `.next/` e suba de novo.

---

## Telas e rotas

| Rota | Tela (rótulos idênticos à plataforma de referência) |
| --- | --- |
| `/trabalhos` | **Trabalhos**: lista única com **geração** e **transcrição ("prévia")**, status, fase, progresso, busca, filtros e "Abrir geração". Skeletons no carregamento. Tema claro e escuro. |
| `/trabalhos/[id]` | **Detalhes do trabalho**: "Execução e resultados" (etapa atual, progresso, tempo decorrido, resumo da produção), "Ver transcrição" (cenas com tempos), "Etapas registradas", excluir; gerações também têm galeria, configuração, cancelar e reexecutar falhas. |
| `/novo-trabalho` | **Novo trabalho** em 4 etapas — **Vídeo** · **Roteiro e produto** (produto, "Transcrever e dividir em cenas" com diálogo de confirmação, cenas editáveis de até 8 s, idioma do vídeo) · **Personalização** (um ou mais avatares, modo do roteiro, formato criativo, eixos de variação Roupa/Cenário/Objeto, modelo de imagem, CTA) · **Revisão** ("Preparar geração" → modal "Confirmar gerações reais no Flow"). Painel "Resumo do trabalho" sempre visível (modelo e resolução). |
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

`src/lib/migrations.ts` — lista de migrações aplicadas **uma vez, em ordem v1 → v2 → v3 → v4** (`PRAGMA user_version`); para
evoluir, **acrescente** um item. Quem as aplica é `src/lib/migrate.ts`: cada migração roda em `BEGIN IMMEDIATE` e **relê a versão
sob o lock** (dois processos subindo juntos não duplicam colunas), com `foreign_keys` desligado só durante a aplicação e
`PRAGMA foreign_key_check` antes de religar. Uma migração que falha é revertida por inteiro.
- **v1**: schema inicial.
- **v2**: prioridade em contas/chaves; segredos de chaves Gemini criptografados; remoção de colunas derivadas
  (`jobs.planned_*`) e inativas (`gemini_keys.enabled/cooldown_until`); `extension_browsers` + `pairing_codes` (vários navegadores).
- **v3**: voz dos avatares, catálogo de produtos, tipo de trabalho (geração/transcrição), formato criativo, modo do roteiro,
  modelo de imagem, CTA, snapshots JSON (avatares, eixos, cenas) e `job_events`.
- **v4** (endurecimento): `jobs` reconstruída com **CHECKs** (formato criativo, modo do roteiro, modelo de imagem), `queued_at`
  (ordem da fila) e **backfill de `avatars_json`** dos trabalhos legados (a partir de `avatar_id/avatar_name`; um trabalho legado
  com vários avatares vira uma entrada única com os nomes juntos — o histórico antigo não guardava a lista); `gemini_keys` sem
  `UNIQUE(api_key)` (inútil com IV aleatório) e com `key_hash` (HMAC) `UNIQUE`; `google_accounts.tier`; avatares com
  `scope/gender/age`; `extension_browsers.flow_reported_at`.
- Dados legados em texto puro (chaves Gemini/Whisper) são criptografados no bootstrap, e `key_hash` é preenchido (duplicatas
  legadas são removidas).

### Segredos

Chaves de API são guardadas **criptografadas (AES-256-GCM)**. A chave mestra vem de `COLDCLICK_SECRET_KEY` ou de
`data/.secret.key` (criada na 1ª execução com a flag `wx`). Se o arquivo existir mas estiver corrompido o app **falha com erro
claro** — nunca gera outra chave em silêncio (isso tornaria ilegíveis as chaves já salvas). Protege contra vazamento do `.db`
isolado — em produção, use um KMS. Chaves Gemini duplicadas são detectadas por HMAC (`key_hash`), sem decifrar nada.
O navegador só recebe máscaras (`••••nzeQ`). Tokens da extensão: só o hash SHA-256 é guardado.

### Transcrição, cenas e "saídas"

- `POST /api/transcriptions` cria um **trabalho de transcrição** (`jobs.kind = 'transcription'`), chama o endpoint Whisper com
  tempos por palavra e divide a fala em **cenas** (`lib/scenes.ts`, puro e testado): frases inteiras agrupadas com no máximo
  **7 s de fala** por cena (clipe de até 8 s, reservando o fim para o corte). Cada etapa vira um evento ("Etapas registradas").
- A API real devolve **palavras sem pontuação** e **segmentos com pontuação**: `alignWordsToSegments` alinha os dois (a copy
  mantém a pontuação e os fins de frase são detectados). Unidades longas demais (segmento inteiro, frase estimada pelo texto)
  são **subdivididas**: nenhuma cena passa do limite.
- O servidor valida as cenas (índices 1..N, fim ≥ início, ≤ 8 s) e **deriva a copy delas** — o `copyText` do cliente é ignorado
  quando há cenas.
- Percentual da transcrição = soma de **pesos por etapa** (`lib/transcription-steps.ts`: solicitada 5 + áudio preparado 15 +
  enviado 15 = **35%**, o valor de "Falhou · 35%" da referência; concluída = 100%).
- Cancelar/excluir uma transcrição **em andamento** aborta a chamada de verdade (ffmpeg + HTTP) e a conclusão tardia nunca a
  ressuscita. Se o servidor cair no meio, o bootstrap marca a transcrição órfã como **falha** (com evento). Um vídeo com
  transcrições pode ser excluído (elas somem junto); só trabalhos de **geração** o bloqueiam.
- **Saídas = avatares escolhidos** (1 se "Pessoa original"); a variação N usa o avatar N mod total. `POST /api/jobs/estimate`
  ("Preparar geração") valida o pedido e devolve saídas, estimativa e contas elegíveis sem gravar nada.
- O executor da fila só processa trabalhos de **geração**.

### Worker e ciclo de vida de um trabalho

`instrumentation.ts` inicia um loop de 1 s (`lib/worker.ts`) que chama `runTick()` (`services/job-runner.ts`):
um trabalho por vez, até 3 itens simultâneos; cada variação = 1 imagem-base + 1 vídeo (o vídeo só inicia com a imagem pronta).

```
pending ─▶ running ─▶ done | pending (nova tentativa) | failed (3 tentativas ou teto de gerações)
trabalho: queued ▶ running ▶ completed | partial | failed | cancelled
```

Teto de gerações = base + folga (`estimate.ts`, calibrada para "20 variações → até 62"). "N falhas" = tentativas que falharam.
Quando o teto (créditos/cota) esgota, o lote é **interrompido**, não vira uma pilha de falhas: os itens restantes ficam
"cancelados" com a marca de interrupção, o evento "Geração interrompida: teto de gerações atingido" é registrado e o trabalho
termina **parcial** — inclusive "0 de 20 vídeos concluídos · 0 falhas", estado visto na referência.
"Reexecutar falhas" dá tentativas novas aos itens que falharam **e aos interrompidos**, amplia o teto e põe o trabalho no **fim**
da fila (`queued_at = agora`; reenfileirar não fura a vez de quem já esperava).

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

App **local, sem login de usuário**; as defesas abaixo protegem contra páginas maliciosas abertas no mesmo computador:

- **Bind em 127.0.0.1** (scripts `dev`/`start`) + `middleware.ts`: só aceita `Host` localhost/127.0.0.1/[::1] (ou
  `COLDCLICK_ALLOWED_HOSTS`) — barra DNS rebinding — e recusa requisições que alteram dados vindas de outra origem
  (`Sec-Fetch-Site`/`Origin`). As rotas da extensão (pareamento e heartbeat) só passam pela checagem de Host; elas se protegem
  por código de uso único / token Bearer.
- Corpos JSON exigem `Content-Type: application/json` (um formulário/`text/plain` de outro site não passa).
- **Importação por URL (SSRF)**: `lib/net-guard.ts` usa `net.BlockList`, **desmapeia IPv6 embutido** (`::ffff:7f00:1`,
  `::ffff:a9fe:a9fe`, NAT64 `64:ff9b::/96`, 6to4, IPv4-compatível), bloqueia `fe80::/10`, `fec0::/10`, ULA, Teredo e multicast,
  exige que **todos** os endereços do nome sejam públicos e **fixa o IP validado na conexão** (sem segunda resolução → sem DNS
  rebinding). Redirecionamentos são revalidados salto a salto e o corpo das respostas 3xx é descartado.
- Arquivos servidos com CSP `sandbox`; limite global de tentativas erradas no pareamento; segredos criptografados em repouso.
- Trocar a **pasta de armazenamento** copia os arquivos para a nova pasta, confere (nº de arquivos e bytes) e só então esvazia a
  antiga; recusa destino não vazio ou aninhado. Nada fica órfão.

---

## Fidelidade visual (`reference/`)

`reference/*.json` (estilos computados) e `reference/*.snap.txt` (textos/hierarquia) vieram da plataforma de referência.
Os tokens do tema estão em `src/app/globals.css` + `tailwind.config.ts` com os **valores exatos** (`--background #080c15`,
`--card #0d1422`, `--sidebar #0b1323`, `--primary #2b6bff`, `--border #24324a`, `--destructive #f0555a`, `--radius 12px`, fonte Inter 14px).
O tema **claro** foi medido **apenas na página Trabalhos** (`reference/shots/jobs-light.png`, `jobs-light.snap.txt`); nas demais
telas a paleta clara é derivada dos mesmos tokens e **não foi conferida contra a referência**.

## Roadmap

- **Fase 3 — Automação real do Flow**: orquestrador (prompts com Gemini + `acquireGeminiKey`), `acquireAccount` no executor,
  `content.js` da extensão (plano no topo do arquivo), recebimento de arquivos/créditos, custo real por modelo/resolução.
- **Pendências de fidelidade**: "Tags/Etiquetas" e avatares **inativos** existem só na plataforma original (a aba "Inativos" fica
  vazia aqui).

### Pontos que NÃO foram verificados contra a referência (honestidade sobre o que é inferência)

- **Modal "Confirmar gerações reais no Flow"** (Revisão → "Preparar geração"): nenhum `.snap.txt` mostra esse estado; o modal
  existe, mas seu texto/layout **não está verificado**. Capture o estado real para conferirmos.
- **"Ponte validada por eco em N ms"**: os textos são os da referência, mas o `N` é o **tempo real de ida e volta ao estúdio**
  (consulta do estado da ponte), não um eco medido na extensão — a extensão desta réplica ainda não responde a "ping".
- **Diálogo de transcrição** usa os literais da referência ("…no Google Flow", "consumir créditos"), mas aqui a transcrição
  usa o **endpoint Whisper configurado** (não o Flow). O texto é fiel à referência, não à implementação.
- **Contas Flow**: "Adicionar conta" e "Remover conta" são mantidos (necessários para a réplica), mas **não aparecem** na captura
  da referência; o contador de ciclo (`x/2 vídeos`) saiu da linha de saldo para seguir o texto da referência.
- **Presets** dos eixos Roupa/Cenário/Objeto são inventados (a referência não lista as opções).
- **Avatar global "Dawn"**: a voz aparece truncada no snapshot ("…Natural imp..."); guardamos até a última frase completa.
  O cartão do assistente mostra "Sem foto" sem ícone de pessoa (instrução da revisão); o snapshot tem um `svg_root` nesse
  cartão que não conseguimos identificar.
