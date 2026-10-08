# Eventos Comanda → CRM (contrato SAI-001 v1)

Rota: `POST /api/integracao/comanda/v1/eventos` (pública no `proxy.ts`, **caminho exato**).
Fonte do contrato: `INTEGRACAO.md` e `docs/contrato/v1/` na Comanda (`SAIAE-APP/saiae-app`). Cópia fixada em
`src/modules/integracao/comanda/contrato/` (ver o `LEIA-ME.md` de lá).

## Como a Comanda chama

Cabeçalhos:

| Cabeçalho | Valor |
|---|---|
| `X-Saiae-Event-Id` | o mesmo UUID do `id` do corpo |
| `X-Saiae-Timestamp` | epoch em **segundos** |
| `X-Saiae-Signature` | `sha256=` + HMAC-SHA256 em hex de `timestamp + "." + corpo bruto`, com o segredo da barraca |

```js
const ts = String(Math.floor(Date.now() / 1000));
const sig = "sha256=" + crypto.createHmac("sha256", segredo).update(ts + "." + corpoBruto).digest("hex");
```

Assine os **bytes exatos** que vão no corpo (não reserialize o JSON depois de assinar).

## Respostas

| Status | Quando |
|---|---|
| **200** | aceito `{received:true}`; duplicata `{received:true,duplicate:true}`; sequence antiga `{received:true,ignored:"sequence_antiga"}`. 2xx = entregue, a Comanda **não** reenvia. |
| 400 | corpo não é JSON |
| 401 | sem cabeçalhos de autenticação, barraca desconhecida, assinatura inválida ou `|agora − timestamp| > 5 min`. A resposta é a mesma nos quatro casos (`Não autorizado`); o motivo só vai para o log do CRM. |
| 413 | corpo maior que 1 MB |
| 422 | corpo fora do schema (devolve só os **caminhos** e a regra, nunca os valores) ou `X-Saiae-Event-Id` ≠ `id` do corpo |
| 503 | `COMANDA_WEBHOOK_SECRETS` ausente ou inválida (**nunca** aceita sem segredo) |

Qualquer resposta que não seja 2xx faz a Comanda reenviar (backoff do contrato). 4xx de assinatura/schema não adianta reenviar igual.

## Configuração (Railway, serviço `app`; nunca no repositório)

`COMANDA_WEBHOOK_SECRETS`: JSON de **barraca_id → segredo**. O valor pode ser uma lista para **rotação** (o novo e o antigo valem juntos).
Cada segredo precisa ter **pelo menos 16 caracteres**; menor que isso é descartado (e se nenhum sobrar, 503).

```
COMANDA_WEBHOOK_SECRETS={"<barraca_id>":"<segredo>","<outra>":["<novo>","<antigo>"]}
```

## O que a rota faz

1. Confere tamanho, cabeçalhos e JSON; pega a `barraca_id` do corpo **só para escolher o segredo**.
2. Confere a janela de 5 min e a assinatura (HMAC, comparação em tempo constante).
3. Só então valida o corpo contra `evento.schema.json` (Ajv, draft 2020-12 + ajv-formats). Para `order.*` valida também `data` contra `#/$defs/pedido`: o schema da Comanda declara `data` só como `object` e **não liga** `pedido` a nenhum tipo, mas o contrato (§2) diz que ele vale para `order.*`. `customer.*` e `coupon.redeemed` aceitam qualquer objeto em `data` (a v1 não define o formato).
4. **Idempotência por `id`** e **ordem por `sequence`** (por barraca e pedido; só a `sequence` **menor** que a já vista é ignorada; igual é processada).
5. Entrega o evento aos consumidores registrados (`registerComandaEventConsumer`) **sem esperar** e responde 200.

## Limites que você precisa conhecer

- **A idempotência e a ordem são EM MEMÓRIA, melhor esforço.** Não sobrevivem a **reinício** (deploy, queda, limite de memória) nem são compartilhadas entre instâncias: depois de um restart, um evento já entregue pode ser entregue de novo e a regra de `sequence` recomeça. Janela de 24 h e no máximo 10 mil entradas de cada tipo (as mais antigas saem primeiro).
  Para garantir idempotência de verdade é preciso guardar `id` e a última `sequence` por pedido numa tabela (**exige mudança de schema**; ver `CRM_SCHEMA_APLICA_NO_MERGE.md`).
- **Hoje não há consumidor registrado:** o evento é validado, deduplicado e **descartado**. Nada é gravado e nenhuma mensagem é enviada.
- **Entrega "no máximo uma vez" para os consumidores:** se um consumidor falhar, a Comanda **não** reenvia (ela recebeu 200).
- O log guarda só o **tipo** do evento e o resultado (aceito, duplicado, ignorado, recusado). **Nunca** telefone, nome, itens nem segredo.

## Código de verificação do cliente final

Rota: `POST /api/integracao/comanda/v1/codigo-verificacao` (pública no `proxy.ts`, **caminho exato**). A Comanda pede o envio do código de login do cliente final; o CRM só o entrega pelo WhatsApp (modelo de **autenticação** da Cloud API). **O CRM não guarda o código, o telefone nem o corpo.**

**Autenticação:** a mesma dos eventos (`X-Saiae-Timestamp` em segundos, `X-Saiae-Signature = "sha256=" + HMAC-SHA256(segredo, timestamp + "." + corpo bruto)`, janela de 5 min, tempo constante), mais `X-Saiae-Event-Id` igual ao `request_id`. A diferença: o segredo é **de plataforma**, não por barraca.

Corpo (exato, sem campos extras):

```json
{ "barraca_id": "<uuid>", "telefone": "61999990001", "codigo": "483920", "request_id": "<uuid>" }
```
`telefone`: 10 ou 11 dígitos, **sem** o 55 (o CRM acrescenta). `codigo`: 6 dígitos. Limite de corpo: 4 KB.

| Status | Quando |
|---|---|
| **200** `{enviado:true}` | enviado; repetição do mesmo `request_id` → `{enviado:true,duplicate:true}` **sem enviar de novo** |
| 400 | JSON inválido |
| 401 `{error:"Não autorizado"}` | cabeçalhos ausentes, janela vencida ou assinatura inválida (**resposta idêntica**) |
| 413 | corpo > 4 KB |
| 422 | corpo fora do contrato (nunca ecoa telefone nem código), `X-Saiae-Event-Id` ≠ `request_id`, ou a Meta recusou (número não entregável, modelo inválido) |
| 429 | limite de taxa da Meta |
| 502 | falha da Meta, de rede ou inesperada |
| 503 | `COMANDA_CODIGO_SECRET` ausente, ou sessão Cloud API indisponível (**nunca** cai para o Baileys: o código não sai por outro canal) |

Modelo da Meta: `codigo_verificacao` (categoria Autenticação, pt_BR, botão "Copiar código"). O CRM manda o código **no corpo e também no botão** (a Meta recusa sem o botão). Texto fixo: "Seu código de verificação é {{1}}."

**Configuração (Railway; nunca no repositório):** `COMANDA_CODIGO_SECRET` (mínimo de 16 caracteres; lista separada por vírgula para rotação; o mesmo valor vai na Comanda), mais `WHATSAPP_CLOUD_SESSION_ID`, `META_WA_ACCESS_TOKEN` e `META_WA_PHONE_NUMBER_ID`. O envio usa a **primeira** sessão de `WHATSAPP_CLOUD_SESSION_ID`.

**Limites:** a idempotência é **em memória** (10 min, até 10 mil), então depois de um reinício uma repetição reenvia o **mesmo** código (não gera um novo), o que é inofensivo. O teto de envios por telefone, aparelho e loja é da **Comanda**, não do CRM. Falha de envio **não** marca o `request_id` como enviado, para a Comanda poder tentar de novo. Log só com o resultado e o tipo do erro: **nunca telefone nem código**.
