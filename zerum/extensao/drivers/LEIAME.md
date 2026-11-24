# `drivers/` — tudo o que depende da aparência do Flow

O Google Flow **não tem API pública**. A extensão opera a página como a própria pessoa faria: abre o projeto, escolhe o
formato, anexa a foto do avatar, escreve o pedido, clica em gerar, espera o clipe aparecer na grade e lê o vídeo. Isso
quebra quando o site muda de visual — por isso **todo o código frágil mora aqui** e o resto da extensão (broker, journal,
ponte, popup) não sabe como o Flow "se parece".

> **Estado atual (honesto):** nada deste módulo foi testado numa conta real do Flow. Os seletores são *palpites*
> razoáveis (exceto o botão da conta, que vem de código que roda em produção na 0.4.18). A lógica está provada contra uma
> página falsa (`test/mock-page.mjs`) e contra um Flow falso em HTTPS dentro de um navegador de verdade
> (`test/browser/mock-flow.mjs`), mas **o ajuste fino contra o site real depende de observação futura**.

## Os três arquivos

| Arquivo | O que é | Quando mexer |
| --- | --- | --- |
| [`selectors.js`](selectors.js) | **DADOS**: para cada elemento lógico (`promptBox`, `generateButton`, `tile`…), uma lista de estratégias de busca. Também `FLOW_ORIGIN`, `MEDIA_HOSTS`, `ALERT_RE` (o que conta como recusa) e `CREDITS_RE` | **O Flow mudou de visual** → quase sempre só este arquivo |
| [`dom-page.js`](dom-page.js) | **MECÂNICA** sobre o DOM: achar elemento visível, clicar (um clique só), digitar em campo controlado pelo framework, injetar arquivo no `<input type=file>`, ler cartões da grade, ler mensagens de erro | O jeito de *interagir* mudou (ex.: o campo virou um editor rico) |
| [`flow-driver.js`](flow-driver.js) | **A SEQUÊNCIA** e a regra de ouro. Não toca no DOM: fala com a "página" (`page`), que é `dom-page.js` no navegador e `test/mock-page.mjs` nos testes | Raramente — mudar aqui muda a *política* de segurança |

### A regra de ouro (não quebre)

O que **não pode ser repetido** é o clique em "gerar" (cada clique pode gastar crédito):

- qualquer falha **antes** do clique → `failed` (nada foi enviado; é seguro refazer);
- qualquer incerteza **depois** do clique (o cartão não apareceu, a aba recarregou, deu timeout) → `unknown`: o broker
  preserva o bloqueio e só **relê**; nunca clica de novo;
- `watch()` e a reconciliação **só leem** a grade — nenhum clique que gere.

Por isso o `page` nunca tem atalho para a API interna do Flow nem para tokens de reCAPTCHA: o clique é o do próprio site,
com a verificação anti-robô dele rodando como sempre.

## Como funciona um seletor

```js
generateButton: {
  status: 'palpite',            // 'verificado' | 'palpite'
  strategies: [                 // tentadas EM ORDEM; a primeira que achar algo VISÍVEL vence
    { text: /^(create|generate|criar|gerar|crear|generar)$/i, tag: 'button' },
    { ariaLabel: /^(create|generate|criar|gerar)\b/i },
    { icon: 'arrow_forward', tag: 'button' },
  ],
  pick: 'lastVisible',          // opcional: em vez do primeiro, o último (ex.: a caixa de prompt "de baixo")
},
```

| Estratégia | Casa por |
| --- | --- |
| `{ css }` | seletor CSS (`hidden: true` aceita elemento invisível — usado no `<input type=file>`) |
| `{ ariaLabel: RegExp, mustContain? }` | atributo `aria-label` (e, se pedido, que contenha uma string, ex.: `@`) |
| `{ text: RegExp, tag? }` | texto visível (ignora o texto de ícones do Material, ex.: `arrow_forward`); prefere o elemento **mais interno** |
| `{ icon, tag? }` | ligadura de ícone do Material dentro de um botão |
| `{ role, name? }` | atributo `role` (+ nome acessível) |

`status: 'verificado'` = o padrão vem de código que roda em produção (hoje só `accountButton`). `status: 'palpite'` = nunca
observado ao vivo. O popup mostra o status ao lado de cada elemento.

## Como ajustar contra o Flow real (passo a passo)

1. Abra o Flow, entre na conta e **abra um projeto** (a extensão precisa ver conta + projeto).
2. Ícone da extensão → **Diagnóstico do Flow**. O relatório lista **elemento por elemento**: achou / não achou, quantos,
   e se o seletor é `verificado` ou `palpite`.
3. Para cada elemento "não achou": no DevTools da aba do Flow, inspecione o elemento real e acrescente uma estratégia
   **no início** da lista (`aria-label`, texto ou CSS estável — evite classes geradas, que mudam a cada versão do site).
4. `chrome://extensions` → recarregue a extensão → rode o diagnóstico de novo. Repita até tudo achar.
5. Troque o `status` para `'verificado'` só do que você **viu funcionar** numa geração de verdade.
6. Rode `npm test` (os testes do driver usam a página falsa e não dependem dos seletores reais).

O que ainda precisa ser observado numa conta real (checklist):

- [ ] **caixa do prompt** e **botão gerar** (`promptBox`, `generateButton`) — e se o botão fica desabilitado até haver texto;
- [ ] **modo** "texto para vídeo" × "quadros para vídeo" (`modeTextToVideo`, `modeFramesToVideo`) e o painel de ajustes (`settingsButton`);
- [ ] **formato 9:16** (`aspectPortrait`) e **quantidade por pedido = 1** (`outputsOne`) — sem este, a extensão **recusa gerar**
  (cada saída gasta crédito) a menos que o popup tenha "O Flow já está em 1 resultado por pedido" marcado;
- [ ] **anexo da imagem do avatar** (`fileInput`, `addImageButton`) e se o Flow aceita o arquivo injetado pelo `DataTransfer`;
- [ ] **grade de clipes**: o que identifica um cartão (`tile`; o código procura um uuid em `data-*`, `href`, `src`), o
  progresso (`tileProgress`) e a mensagem de falha **dentro** do cartão (`tileError`);
- [ ] **onde fica o `<video>` pronto** (`flow-content.google` ou `blob:`) — a entrega de mídia depende disso. Se o host real
  for outro, acrescente-o em `MEDIA_HOSTS` (`selectors.js`) **e** em `host_permissions` do `manifest.json` (o service worker
  só baixa de hosts da lista; `blob:` é lido dentro da própria aba);
- [ ] **créditos** (`creditsText`) — sem ele a conta aparece sem saldo (`credits: null`) e a "troca abaixo de N créditos" não age;
- [ ] **avisos de recusa** (`ALERT_RE`) — o texto real do Flow para cota/política/crédito (traduzido para códigos por
  `errorCodeFromFlowText` em `lib/protocol.js`).

## Contrato do `page` (o que o driver exige)

`identity()` · `readCredits()` · `probe()` · `prepareComposer({aspectRatio, model, hasFrame})` · `attachFirstFrame(file)` ·
`typePrompt(text)` · `readPrompt()` · `clickGenerate()` · `snapshotTiles()` · `readTile(id)` · `readErrors()` · `mediaBytes(url)`.

Se o Flow ganhar uma etapa nova (um diálogo de confirmação, por exemplo), o lugar é `prepareComposer` (antes do clique) —
**nunca** depois de `clickGenerate`, onde qualquer erro vira `unknown`.

## O que este módulo NÃO faz (de propósito)

- não chama endpoints internos do Flow nem reproduz as chamadas de rede dele;
- não captura, guarda nem reutiliza tokens de reCAPTCHA;
- não troca de conta nem de modelo para fugir de cota (`429` → a conta pausa 24 h; quem decide trocar é o app);
- não gera mais de um resultado por pedido sem que o usuário afirme isso no popup;
- não envia nada para fora do navegador (o teste `network-audit.test.mjs` falha se aparecer rede nova).
