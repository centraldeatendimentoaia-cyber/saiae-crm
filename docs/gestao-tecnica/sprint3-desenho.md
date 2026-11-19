# Sprint 3 (Multiempresa): desenho do vínculo empresa / usuário / conexão

## Decisão

Não criar tabela nem coluna nova. "Empresa" continua sendo o **usuário dono (`User`)**; a conexão é a **`Session`** (WhatsApp Baileys) ou uma **sessão Cloud** (id listado em `WHATSAPP_CLOUD_SESSION_ID`); a loja da Comanda é a **barraca** (`BarracaSessao.barracaId`). O que faltava era só ligar, de forma explícita, "número da Meta -> sessão" e "barraca -> sessão" na Cloud API.

## Cadeia de vínculo (o que já existe)

| Elo | Onde | Chave |
|---|---|---|
| Empresa -> conexão | `Session.userId` (+ `SessionAccess` para compartilhar) | `canAccessSession` |
| Conexão Baileys -> dados | `Contact`, `Message`, `AutoReply` etc. | `sessionId` (cuid, com relação Prisma) |
| Conexão Baileys -> barraca | `BarracaSessao` | `barracaId` -> `sessionId` (único) |
| Conexão Baileys -> IA/avisos/opt-out | `AgenteConversa`, `OptOut`, `BroadcastLog` | `sessionId` como texto |
| Número Cloud -> sessão | **novo, por ambiente** | `WHATSAPP_CLOUD_PHONE_MAP` |
| Barraca -> sessão Cloud | **novo, por ambiente** | `WHATSAPP_CLOUD_BARRACA_MAP` |
| Conversa da IA -> loja | `IaConversa(lojaCodigo, contactKey)` | código da loja no link |

## Mapas Cloud (sem schema)

```
WHATSAPP_CLOUD_SESSION_ID   = loja-a,loja-b                     (já existia)
WHATSAPP_CLOUD_PHONE_MAP    = {"<phone_number_id>":"loja-a", ...}
WHATSAPP_CLOUD_BARRACA_MAP  = {"<barraca_id>":"loja-a", ...}
```

Regras (`src/modules/whatsapp/provider/cloud-sessao.ts`):

1. Zero sessões Cloud: nada muda (consumidor registra sem sessão; notificador diz "Cloud API não configurada").
2. **Exatamente uma** sessão e nenhum mapa: usa essa sessão, como hoje.
3. Mapa presente e chave encontrada: usa a sessão mapeada, se ela estiver na lista Cloud; senão `sem_correspondencia`.
4. Várias sessões sem correspondência: `ambigua`. Nunca a primeira da lista. O chamador registra (log só com o motivo) e não envia nem grava nada.
5. O número que **envia** é um só (`META_WA_PHONE_NUMBER_ID`, credencial global). Com várias sessões, só se envia pela sessão dona desse número (`numeroDeEnvioPertence`). Mensagem recebida em outro número é recusada: responderia pelo número errado.

## Limite conhecido (precisa de decisão do João)

As credenciais da Cloud API continuam globais (um token, um número). Esta sprint impede o envio **errado**, mas não habilita enviar por vários números. Para multiempresa de verdade na Cloud: token/número por sessão (variável JSON com segredo, ou tabela `CloudNumero`). Isso é proposta, não implementado.

## Propostas de schema (NADA aplicado; só aditivas; exigem revisão do João, o Dockerfile roda `db push` no start)

1. `IaConversa.sessionId String?` + índice (e `@@unique([lojaCodigo, contactKey])` seguiria valendo): hoje a conversa da IA não sabe por qual número chegou; `lojaDaConversa(contactKey)` e `IaWindowStore` olham o cliente em qualquer loja/número.
2. `IaMensagem.phoneNumberId String?` para a janela de 24 h ser por número (a Meta conta a janela por número).
3. Tabela `CloudNumero(phoneNumberId @id, sessionId, barracaId?)` substituindo os dois mapas de ambiente.
4. Relação Prisma `BroadcastLog/OptOut/AgenteConversa -> Session` (hoje `sessionId` texto, sem cascata).
5. `Empresa` + `empresaId` em `User/Session` só se um dia houver mais de um usuário por empresa.
