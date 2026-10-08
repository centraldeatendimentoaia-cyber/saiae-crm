# WhatsApp Cloud API (oficial): piloto de 1 número

Estado: **preparado, desligado por padrão.** Nenhuma sessão usa a Cloud API até o dono definir as variáveis abaixo.
Nada aqui altera o banco: a escolha é por variável de ambiente.

## Variáveis (Railway, serviço `app`) — nunca no repositório

| Variável | Para quê |
|---|---|
| `WHATSAPP_VERIFY_TOKEN` | Texto que o dono escolhe; o mesmo vai no campo "Verificar token" do webhook no painel da Meta. |
| `WHATSAPP_APP_SECRET` | "Chave secreta do app" na Meta. Valida a assinatura de cada evento. |
| `META_WA_ACCESS_TOKEN` | Token de acesso (usuário do sistema) do app. **Segredo.** |
| `META_WA_PHONE_NUMBER_ID` | `phone_number_id` do número na Meta (não é o telefone). |
| `WHATSAPP_CLOUD_SESSION_ID` | ID da(s) sessão(ões) do CRM que usam a Cloud API, separadas por vírgula. |
| `WHATSAPP_GRAPH_API_VERSION` | Versão da Graph API (padrão `v25.0`). **O dono deve confirmar a versão usada pelo app da Meta.** |

URL do webhook para colar na Meta: `https://<domínio-do-crm>/api/whatsapp/webhook`.

## Como a sessão é escolhida

1. Crie a sessão normalmente no painel (ela nasce como as outras) e anote o ID.
2. Coloque esse ID em `WHATSAPP_CLOUD_SESSION_ID`.
3. **Não conecte o Baileys nessa sessão.** A variável vence: o envio passa a sair pela Cloud API.

Regras de segurança do código:
- Sessão listada **sem** `META_WA_ACCESS_TOKEN` e `META_WA_PHONE_NUMBER_ID` fica **indisponível** (503 nas rotas). **Nunca cai para o Baileys em silêncio**, para uma mensagem não sair por outro canal.
- Sessões não listadas continuam exatamente como hoje (Baileys).

## O que funciona no piloto

| Recurso | Cloud API |
|---|---|
| **Template aprovado** (`sendTemplate`) | Sim. É o que os avisos de pedido usam; não depende da janela de 24 h. |
| Texto livre e mídia | **Bloqueados** (falha fechada, `WindowClosedError`) até existir armazenamento da última mensagem do cliente. Nenhuma chamada à Meta é feita. |
| Enquete, grupos, reações, figurinha, apagar/editar, lista, contato, localização, reply, encaminhar | Não existem. As rotas respondem **501** `CAPABILITY_NOT_SUPPORTED`. |
| Envio para cliente só com BSUID (telefone oculto) | Ainda não implementado (erro `unsupported` claro). |

Efeitos a conhecer numa sessão Cloud API:
- **Disparo em massa e mensagens agendadas** (texto livre) falham por destinatário com a mensagem da janela fechada. É intencional no piloto.
- **Mensagens recebidas** chegam ao webhook, são normalizadas e entregues aos consumidores registrados (hoje nenhum): não responde nada, não grava nada.

## Antes de ligar de verdade (checklist do dono)

- [ ] Conta e verificação do negócio na Meta; número dedicado.
- [ ] Templates de utilidade aprovados (pedido recebido, em preparo, pronto, saiu para entrega).
- [ ] Confirmar a versão da Graph API do app e ajustar `WHATSAPP_GRAPH_API_VERSION` se preciso.
- [ ] Definir as variáveis no Railway e **só então** clicar em "verificar" o webhook na Meta.
- [ ] Teste real no sandbox da Meta: **os payloads de exemplo e os códigos de erro do código ainda não foram conferidos contra a Meta** (ver `cloud/errors.ts` e `cloud/fixtures.ts`).
- [ ] Revisar o custo por mensagem da Meta antes de definir preço dos planos.

## O que falta (precisa de mudança de banco, ver `CRM_SCHEMA_APLICA_NO_MERGE.md`)

- Guardar a **última mensagem do cliente** por sessão e contato (`contactKey` = telefone, senão BSUID) para liberar texto livre dentro das 24 h. Hoje a janela fica sempre fechada.
- Escolha do provedor por sessão no banco (coluna `provider`), em vez da variável de ambiente.
