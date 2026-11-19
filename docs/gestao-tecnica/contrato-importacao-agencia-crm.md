# Contrato de importação agência para CRM (proposta)

Estado: proposta de desenho, nada implementado. Base: CRM no commit `48cb963` e o formato real dos pacotes descrito em `agencia-pacote-formato.md`. Piloto: cliente LAVI (`lavi`).

## 1. API de posts sociais existente (levantamento)

### 1.1 Autenticação e escopo

- Todas as rotas usam `getAuthenticatedUser` (`src/lib/api-auth.ts`): cabeçalho `x-api-key: wag_...` (a chave é guardada como hash SHA-256 em `User.apiKeyHash`; chave legada em texto é migrada no primeiro uso) ou sessão do painel. Sem credencial: `401 {status:false,message:"Unauthorized"}`.
- Tudo é escopado por `userId`: uma chave de API enxerga só as contas, mídias e posts do próprio usuário. Não há escopo por permissão (a chave dá acesso total ao módulo social e às demais rotas do usuário).
- Resposta padrão: `{ status: boolean, message?, data? }`.

### 1.2 Modelos (`prisma/schema.prisma`)

- `SocialAccount`: `id`, `userId`, `provider` (`instagram`|`facebook`), `externalId`, `pageId`, `name`, `username`, `nickname`, `color`, `postingTimes` (JSON de horários sugeridos), `accessToken` (AES-256-GCM, nunca devolvido). Único por `(userId, provider, externalId)`.
- `MediaFile`: `id`, `userId`, `name`, `mime`, `size`, `data` (bytes no banco), `publicToken` (criado quando a mídia vai para um post).
- `ScheduledPost`: `id`, `userId`, `accountId`, `type` (`FEED`|`STORY`), `caption`, `mediaIds` (JSON de `MediaFile.id`), `publishAt` (nulo só em rascunho), `groupId`, `seriesId`, `seriesIndex`, `status`, `releaseId`, `releaseUrl`, `error`, `publishedAt`, `createdAt`.
- `PostSeries`: série recorrente (`name`, `accountIds`, `type`, `weekdays` 0=domingo, `time` HH:MM Brasília, `startDate`, `endDate`, `maxCount`, `variants[{caption,mediaIds}]`, `status` `ACTIVE|PAUSED|ENDED`, `generatedCount`).
- `SocialSignature`: textos salvos (endereço, horário, CTA) para colar em legendas.

### 1.3 Rotas

| Rota | Função |
|---|---|
| `GET /api/social/accounts` | Lista contas conectadas (sem token): `id, provider, externalId, pageId, name, username, nickname, color, postingTimes` |
| `POST /api/social/accounts` `{userToken}` | Descobre Páginas/Instagram Business pelo token Meta e grava contas |
| `GET/PATCH/DELETE /api/social/accounts/[id]`, `.../status` | Gestão da conta |
| `POST /api/uploads` (multipart, campo `file`) | Envia imagem JPG/PNG/WebP, máx. 5 MB, sujeita a quota por dono. Devolve `{data:{url:"/api/uploads/<id>", type, name}}`. O id da mídia é o último segmento da URL; não há campo `id` separado |
| `GET /api/uploads/[id]` | Baixa a imagem |
| `GET /api/public-media/[token].jpg` | URL pública usada pela Meta; sempre devolve JPEG (converte PNG/WebP com `sharp`) |
| `GET /api/social/posts` | Filtros `from`, `to`, `accountId`, `status` (lista), `tab`, `limit` (padrão 500, máx. 1000). Devolve cada post com `account` resumida |
| `POST /api/social/posts` | Corpo `{accountIds[]\|accountId, type, caption, mediaIds[], dates[]\|publishAt, draft?}`. Cria 1 post por conta x data com um `groupId` novo. Devolve só `{count, groupId}` (não devolve os ids dos posts) |
| `GET /api/social/posts/[id]` | Um post, com `groupEditable` |
| `PATCH /api/social/posts/[id]` | Só `DRAFT` e `PENDING`. Altera `type`, `caption`, `mediaIds`; `publishAt` reagenda (rascunho vira `PENDING`); `draft:true` volta a rascunho; `applyToGroup` |
| `DELETE /api/social/posts/[id]` | Remove (409 se `PUBLISHING`); `?group=1` remove o grupo ainda não enviado |
| `GET/POST /api/social/series`, `/series/[id]` | Série recorrente; cria e já gera as próximas semanas |
| `GET/POST /api/social/signatures` | Assinaturas de legenda |

### 1.4 Regras de validação (`src/modules/social/validate.ts`)

- `type` só `FEED` ou `STORY`. Reel e vídeo não existem.
- `mediaIds`: 1 a 10 sem repetição; Story exatamente 1; todas precisam pertencer ao usuário (senão 400 "Imagem não encontrada").
- Legenda: Instagram até 2200 caracteres; em Story a legenda é descartada (gravada vazia).
- Datas: até 60 por requisição, sem repetição, máx. 120 posts por requisição, não podem estar mais de 5 minutos no passado. `draft:true` ignora datas.
- Série: máx. 5 contas, 12 variações, 200 ocorrências; horizonte de geração de 56 dias.

### 1.5 Estados e publicação

Estados de `ScheduledPost.status`: `DRAFT`, `PENDING`, `PAUSED`, `PUBLISHING`, `PUBLISHED`, `FAILED`. O agendador (`scheduler.ts`) roda a cada minuto, pega `PENDING` com `publishAt <= agora`, faz o claim `PENDING -> PUBLISHING` (evita duplicidade), publica no Graph API e grava `PUBLISHED` com `releaseId`, `releaseUrl`, `publishedAt`, ou `FAILED` com `error` (e cria `Notification`). Queda do servidor no meio da publicação vira `FAILED` com aviso, sem republicar sozinho. Não há webhook nem callback de saída quando o estado muda.

### 1.6 MCP `saiae-crm`

O código do servidor MCP não está neste repositório (busca por `rascunho_post_instagram` e `mcp` não encontrou nada). As ferramentas expostas ao agente são:

| Ferramenta | Parâmetros | Efeito |
|---|---|---|
| `listar_contas_sociais` | nenhum | Lista contas (ids para os rascunhos) |
| `rascunho_post_instagram` | `contaId`, `tipo` (`FEED`\|`STORY`), `legenda`, `imagens[]` (máx. 10) | Cria post como `DRAFT`, sem data, não publica |
| `listar_posts_agendados` | `limite` (1 a 50), `status` (lista) | Lista a fila |
| `solicitar_envio` | `tipo` (`campanha`\|`post`), `postId`, `publicarEm`, `rascunhoId` | Não publica: cria pedido em "Esperando aprovação"; só o clique de aprovação do João executa |
| `rascunho_campanha`, `metricas`, `buscar_contatos`, `ver_contato`, `etiquetar_conversa`, `listar_etiquetas`, `listar_campanhas` | | Campanhas WhatsApp e métricas (fora do escopo de posts) |

Pontos a confirmar na fonte do MCP (não verificável aqui): se `imagens` aceita ids de `MediaFile`, URLs ou caminhos; onde fica a fila "Esperando aprovação" (pelas descrições, vive no escritório de IA, não no CRM); se o MCP usa a mesma chave `x-api-key`.

## 2. O que falta para importação idempotente

| Necessidade | Hoje | Lacuna |
|---|---|---|
| Chave de idempotência | Nenhuma. `POST /posts` sempre cria novas linhas; cada chamada gera `groupId` novo | Sem campo para chave externa nem restrição de unicidade; repetir a chamada duplica |
| Cliente, slug, versão | Inexistentes no modelo | Sem origem (`agencia`), cliente, semana, slug, versão ou hash do conteúdo |
| Detectar mudança | Impossível comparar | Sem hash de conteúdo |
| Retorno de ids | `POST` devolve só `count` e `groupId` | Não devolve ids dos posts criados, nem dos `MediaFile` como campo próprio |
| Upload de mídia | Um arquivo por chamada, id embutido na URL | Sem upload em lote nem dedupe por checksum (reimportar sobe a imagem de novo e consome quota) |
| Bloqueio de reprovados | Nada; o CRM aceita qualquer corpo | A agência precisa barrar na origem e o CRM precisa recusar status não aprovado |
| Data do rascunho | Rascunho não tem `publishAt` | A data planejada pela agência se perde no `DRAFT` |
| Hashtags | Só `caption` | Concatenar legenda + hashtags no importador |
| Reel | Não suportado (`FEED`\|`STORY` com imagem) | Só dá para importar a capa como material de apoio ou deixar de fora |
| Story com legenda | Descartada | Informar na resposta que foi descartada |
| Estados de retorno | Só consulta por GET | Sem webhook; a agência precisa fazer polling |
| Aprovação no CRM | Estados técnicos, sem `APPROVED` | Hoje `DRAFT -> PENDING` por PATCH com `publishAt` é o único gesto de aprovação |
| Cliente a conta | Contas por `userId` | Um usuário do CRM por cliente é a única fronteira de tenant; não há `clientId` |
| Auditoria | Nenhuma | Sem log de quem importou o quê |

## 3. Proposta de contrato

### 3.1 Princípios

1. Reutilizar `ScheduledPost`, `MediaFile` e `/api/uploads`. Nenhuma tabela de posts nova.
2. A agência nunca publica: importa sempre como `DRAFT`. A passagem para `PENDING` (agendado) continua sendo uma ação humana no CRM (ou `solicitar_envio` com aprovação do João).
3. A importação é um upsert determinístico por chave externa. Reenviar o mesmo pacote não duplica nada.
4. Reprovado, `bloqueado_lint` ou `pendente_aprovacao` nunca entra.
5. Mudanças só em tabelas e colunas novas e opcionais (o CRM roda `prisma db push` em todo start e o schema vai direto à produção; ver aviso no `schema.prisma`).

### 3.2 Mudanças mínimas no CRM (para uma implementação futura)

Opção recomendada, sem alterar a tabela quente `ScheduledPost`: tabela de vínculo.

```prisma
model ExternalPostLink {
  id          String   @id @default(cuid())
  userId      String
  source      String   // "agencia"
  externalKey String   // "lavi:2026-S47:carrossel-esmaltacao-gel-incluso"
  version     Int
  contentHash String   // sha256 do conteúdo normalizado
  postId      String   // ScheduledPost.id
  plannedAt   DateTime? // data planejada pela agência (o DRAFT não tem publishAt)
  meta        Json?    // semana, formato original, pasta do pacote
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@unique([userId, source, externalKey])
  @@index([postId])
}
```

Rota nova: `POST /api/social/import/agencia` (mesma autenticação `x-api-key`) e `GET /api/social/import/agencia/status?keys=...` (ou `?semana=`). A rota orquestra as funções existentes (`parseNewPost`/`parseContent`, `ensurePublicTokens`, `mediaStorage.save`); não duplica regra.

### 3.3 Esboço de JSON Schema (requisição)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "ImportacaoAgencia",
  "type": "object",
  "required": ["contrato", "cliente", "semana", "pecas"],
  "properties": {
    "contrato": { "const": "agencia-crm/1" },
    "cliente": { "type": "string", "pattern": "^[a-z0-9-]+$" },
    "semana": { "type": "string", "pattern": "^\\d{4}-S\\d{2}$" },
    "modo": { "enum": ["validar", "importar"], "default": "validar" },
    "pecas": {
      "type": "array", "minItems": 1, "maxItems": 60,
      "items": {
        "type": "object",
        "required": ["slug", "versao", "formato", "status_editorial", "legenda", "midias", "hash"],
        "properties": {
          "slug": { "type": "string", "pattern": "^[a-z0-9-]+$" },
          "versao": { "type": "integer", "minimum": 1 },
          "formato": { "enum": ["carrossel", "stories", "reel"] },
          "status_editorial": { "enum": ["aprovado"] },
          "aprovado_por": { "type": "string" },
          "aprovado_em": { "type": "string", "format": "date-time" },
          "lint": { "type": "object", "properties": { "erros": { "const": 0 }, "avisos": { "type": "integer" } } },
          "data_planejada": { "type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$" },
          "hora_planejada": { "type": "string", "pattern": "^([01]\\d|2[0-3]):[0-5]\\d$" },
          "legenda": { "type": "string", "maxLength": 2200 },
          "hashtags": { "type": "string" },
          "cta": { "type": "string" },
          "hash": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
          "midias": {
            "type": "array", "minItems": 1, "maxItems": 10,
            "items": {
              "type": "object", "required": ["nome", "mime", "sha256"],
              "properties": {
                "nome": { "type": "string" },
                "mime": { "enum": ["image/png", "image/jpeg", "image/webp"] },
                "sha256": { "type": "string" },
                "ref": { "type": "string", "description": "parte multipart ou URL temporária" }
              }
            }
          }
        }
      }
    }
  }
}
```

`status_editorial` só aceita `aprovado`: o esquema já impede reprovado, rascunho e bloqueado. Reel com `video` fica fora desta versão do contrato.

### 3.4 Chave de idempotência

`externalKey = <cliente>:<semana>:<slug>`. A versão e o `hash` decidem a ação:

| Situação no CRM | Ação |
|---|---|
| Chave inexistente | Cria mídias, cria `DRAFT`, cria `ExternalPostLink`, retorno `criado` |
| Chave existe, mesmo `hash` | Nada, retorno `inalterado` com os ids existentes |
| Chave existe, `hash` diferente, `versao` maior, post ainda `DRAFT` ou `PENDING` | `PATCH` equivalente (legenda e mídias), atualiza vínculo, retorno `atualizado` |
| Chave existe, hash diferente e post `PUBLISHING`, `PUBLISHED` ou `FAILED` | Recusa `conflito_publicado` (não altera nada) |
| `versao` menor ou igual à registrada com hash diferente | Recusa `versao_antiga` |

Hash: SHA-256 de JSON canônico (chaves ordenadas) com `slug`, `formato`, `legenda`, `hashtags`, `data_planejada`, `hora_planejada` e a lista ordenada de `sha256` das mídias. Mídias com mesmo `sha256` já enviadas pelo mesmo usuário são reaproveitadas (exige coluna ou tabela de checksum na mídia; sem isso, reenviar consome quota).

### 3.5 Validações do importador

Falha de qualquer item rejeita só esse item (resposta parcial), nunca grava metade de um post.

1. Autenticação por `x-api-key`; o `userId` da chave deve ser o usuário mapeado ao `cliente` (3.6).
2. `status_editorial = aprovado` e `lint.erros = 0`; `bloqueado_lint` e `pendente_aprovacao` rejeitados.
3. Reaplicar as regras do CRM: tipo, 1 a 10 imagens, Story com 1 imagem, legenda (+ hashtags) até 2200, mime e 5 MB por imagem, quota de mídia.
4. Legenda final = `legenda` + linha em branco + `hashtags` (igual ao `legenda.txt` do pacote). Em Story, avisar que a legenda é descartada.
5. `data_planejada` + `hora_planejada` em horário de Brasília guardados em `plannedAt` (o post fica `DRAFT` sem `publishAt`). Data no passado gera aviso, não erro.
6. Reel: recusar o item com `formato_nao_suportado` enquanto o CRM não aceitar vídeo.
7. Modo `validar` executa tudo sem gravar nada.
8. Limites: 60 peças por chamada; corpo multipart ou mídias por URL temporária assinada (a decidir).

### 3.6 Mapeamento cliente para empresa e conta social

Tabela de configuração mantida no CRM (ou em arquivo da agência versionado), não no pacote:

```json
{ "lavi": { "crmUserId": "<id do usuário da LAVI no CRM>", "contaPadrao": "<SocialAccount.id Instagram da LAVI>", "contasPorFormato": { "stories": "<id>", "carrossel": "<id>" } } }
```

Regras: um cliente da agência aponta para exatamente um `userId` do CRM; a chave de API usada na importação pertence a esse usuário; a conta social precisa existir em `GET /api/social/accounts` desse usuário e ter `provider = instagram`. Conta ausente: recusar o lote inteiro com `conta_nao_encontrada` (não adivinhar). O `handle` do slide de CTA (ex.: `@laviconcepttagua`) serve de conferência cruzada com `SocialAccount.username`. Para o Sai aê (`saiae`) vale o mesmo, com o seu próprio usuário. Pendência conhecida (memória do projeto): a LAVI ainda depende da migração para o CRM neutro; confirmar que o usuário e a conta Instagram da LAVI existem antes do piloto.

### 3.7 Resposta

```json
{
  "status": true,
  "lote": "<id do lote>",
  "resumo": { "criado": 7, "atualizado": 1, "inalterado": 0, "rejeitado": 1 },
  "itens": [
    { "externalKey": "lavi:2026-S47:carrossel-esmaltacao-gel-incluso", "resultado": "criado",
      "postId": "<ScheduledPost.id>", "groupId": "<id>", "mediaIds": ["<id>"],
      "estado": "DRAFT", "urlPainel": "/dashboard/redes-sociais/...", "avisos": [] },
    { "externalKey": "lavi:2026-S47:story-indique-e-ganhe", "resultado": "rejeitado",
      "erro": { "codigo": "status_nao_aprovado", "mensagem": "..." } }
  ]
}
```

Códigos de erro: `status_nao_aprovado`, `lint_com_erro`, `conta_nao_encontrada`, `formato_nao_suportado`, `midia_invalida`, `legenda_longa`, `quota_midia`, `versao_antiga`, `conflito_publicado`, `hash_invalido`.

### 3.8 Ciclo de retorno

1. Agência importa como `DRAFT`. CRM devolve `postId`, `mediaIds` e estado.
2. A agência grava o retorno localmente (`pacote/importacao-crm.json` com `externalKey`, `postId`, `estado`, `versao`, `hash`); isso evita reimportar sem querer.
3. Humano revisa no CRM e agenda (`PATCH publishAt` leva a `PENDING`) ou usa `solicitar_envio` com aprovação.
4. A agência consulta o estado por `GET .../import/agencia/status?semana=` (polling, por exemplo na rotina diária). Devolve por chave: `estado` (`DRAFT|PENDING|PAUSED|PUBLISHING|PUBLISHED|FAILED`), `publishAt`, `releaseId`, `releaseUrl`, `publishedAt`, `error`.
5. `FAILED` retorna `error`; a correção segue pelo CRM (reagendar) ou por nova `versao` da peça. Webhook de saída fica como evolução (o CRM já tem tabela de webhooks por sessão WhatsApp, não para social).
6. Métricas da publicação voltam para `clientes/<slug>/metricas/` por exportação separada (fora do escopo deste contrato).

## 4. Mudanças necessárias no lado da agência

- `pacote.py` passaria a gerar um `manifesto.json` por semana: `cliente`, `semana`, por peça `slug`, `versao`, `hash`, `status_editorial` (derivado do CSV), `lint`, `legenda`, `hashtags`, `data`, `hora`, `midias` com `sha256`. Hoje isso não existe.
- Incrementar `versao` quando o hash da peça mudar entre rodadas (registrar o último hash).
- Ler o veredito do `revisao.md` ou, melhor, passar a gravar o resultado do revisor num campo estruturado; hoje o status só reflete o lint e a aprovação do fundador no CSV.
- Importar só linhas com `status = aprovado`.
- O mp4 de Reel não entra enquanto o CRM não tiver vídeo.

## 5. Plano do piloto LAVI (sugestão)

1. Confirmar usuário, chave de API e conta Instagram da LAVI no CRM de staging.
2. Escolher uma semana já aprovada (por exemplo 2026-S47: 9 peças, sendo 7 stories e 2 carrosséis) e rodar em modo `validar`.
3. Importar como `DRAFT` em staging; conferir legenda+hashtags, ordem dos slides e a conversão PNG para JPEG.
4. Reimportar o mesmo manifesto e confirmar `inalterado` em todos os itens (teste de idempotência).
5. Alterar uma legenda, subir a `versao` e confirmar `atualizado`; aprovar e agendar um post manualmente no CRM; consultar o retorno.

## 6. Riscos e decisões pendentes

- Alterar `schema.prisma` publica no banco de produção no próximo start (`prisma db push`); a tabela nova deve ser aditiva e revisada com o João antes do merge.
- Chave de API dá acesso total ao usuário; criar um usuário de serviço por cliente, ou um escopo de chave só para importação, reduz o risco.
- Armazenar mídia no banco pesa: importação semanal de dezenas de PNGs de até 2 MB precisa respeitar `quotaMidiaBytes` e a retenção.
- Decidir onde a aprovação final acontece: no CRM (clique) ou apenas na agência (CSV `aprovado`). Recomendação: manter as duas, com a importação sempre em `DRAFT`.
- Confirmar a semântica de `imagens` no MCP e se o MCP pode ser reaproveitado como cliente do importador.
