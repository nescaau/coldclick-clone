# Extensão Chrome — ColdClick Conector (esqueleto)

Extensão Manifest V3 que fará a ponte entre o Estúdio Criativo local e o Google Flow.

## Estado atual

| Arquivo | O que faz hoje |
| --- | --- |
| `manifest.json` | Service worker, content script (em `flow.google.com` e `labs.google/fx`) e popup. Chrome 116+. |
| `background.js` | **Funcional:** pareamento por código e heartbeat a cada 30 s (`chrome.alarms`), informando versão e se há aba do Flow aberta. |
| `popup.html` / `popup.js` | **Funcional:** endereço do estúdio + código de pareamento. |
| `content.js` | **Stub:** responde `PING` e documenta, em comentários, o plano de automação do Flow. |

## Como instalar

1. Rode o estúdio (`npm run dev`), abra **Contas Flow**, dê um nome ao Chrome e clique em *Criar código de pareamento*.
   (Ou use *Baixar extensão* na própria página e extraia o ZIP.)
2. No Chrome: `chrome://extensions` → **Modo do desenvolvedor** → **Carregar sem compactação** → pasta `extension/`.
3. Abra o popup da extensão, confirme o endereço (`http://localhost:3000`), digite o código e clique em **Parear**.
4. O navegador aparece em **Navegadores pareados** como *Online no ColdClick*. Abra o Flow em uma aba para ativar a "Sessão Google Flow".

## Contrato com a API do estúdio

- `POST /api/extension/pair` `{ code, deviceName?, version? }` → `{ token, rules }` (o código é de uso único; o nome do navegador vem do código).
- `POST /api/extension/heartbeat` (`Authorization: Bearer <token>`) corpo opcional
  `{ version, flowSessionActive, flowAccountEmail }` (campos ausentes **não** zeram o estado do Flow: o último relato vale por 5 min) → `{ ok, serverTime, rules, tasks: [] }`. `401` = pareamento revogado.

Na fase 3, `tasks` passa a carregar as gerações pendentes; novos endpoints recebem os arquivos gerados e o saldo de créditos.
O plano detalhado está no topo de `content.js`.

## Observações

- As chamadas ao estúdio saem do **service worker** (com `host_permissions` não há bloqueio de CORS); o content script nunca fala direto com o estúdio.
- Para usar outra porta/endereço, adicione-o em `host_permissions` no `manifest.json`.
