# Documentação do Saiaê CRM

Este CRM nasceu de um projeto open source de gateway WhatsApp (Baileys + Next.js + Prisma). Os documentos herdados dele ficam em [`upstream/`](./upstream/README.md); tudo o que está fora dessa pasta foi escrito para o Saiaê.

## Do Saiaê

### IA de atendimento

| Documento | Para que serve |
| :--- | :--- |
| [IA_ATENDIMENTO.md](./IA_ATENDIMENTO.md) | Visão geral da atendente de IA no WhatsApp (API oficial), tarefa a tarefa. Tudo desligado por padrão. |
| [IA_CONTEXTO_COMANDA.md](./IA_CONTEXTO_COMANDA.md) | Cliente que busca o contexto da loja na Comanda. |
| [conhecimento-saiae-vendas.md](./conhecimento-saiae-vendas.md) | Como manter o conhecimento da atendente de vendas (a fonte é `src/modules/ia-atendimento/vendas/conhecimento.ts`). |
| [conhecimento-vendas-para-revisao.md](./conhecimento-vendas-para-revisao.md) | Resumo em português simples do que a atendente de vendas afirma, para revisão antes de ligar `IA_VENDAS`. |
| [texto-agente-saiae.md](./texto-agente-saiae.md) | Texto de instruções (tom e regras de conversa) do agente. |
| [AGENTE_SALAO.md](./AGENTE_SALAO.md) | Agente de atendimento do salão, que roda no número do salão (sessão QR). Diferente da IA de vendas. |

### WhatsApp oficial (Cloud API) e Meta

| Documento | Para que serve |
| :--- | :--- |
| [CLOUD_API_PILOTO.md](./CLOUD_API_PILOTO.md) | Piloto de 1 número na Cloud API. Desligado por padrão. |
| [CADASTRO_CLIENTE_API_OFICIAL.md](./CADASTRO_CLIENTE_API_OFICIAL.md) | Passo a passo (rascunho) para cadastrar um cliente em disparos pela API oficial. |
| [templates-meta-ia.md](./templates-meta-ia.md) | Template da Meta `ia_chamar_dono`, usado para avisar o responsável da loja. |

### Integração com a Comanda

| Documento | Para que serve |
| :--- | :--- |
| [INTEGRACAO_COMANDA_EVENTOS.md](./INTEGRACAO_COMANDA_EVENTOS.md) | Contrato dos eventos Comanda -> CRM (SAI-001 v1), assinatura e janela de tempo. |
| [whatsapp-avisos-baileys.md](./whatsapp-avisos-baileys.md) | Avisos de status do pedido ao cliente pelo WhatsApp (Baileys) de cada barraca: conexão por QR, fila e variáveis. |

### Qualidade e manutenção

| Documento | Para que serve |
| :--- | :--- |
| [auditoria-crm.md](./auditoria-crm.md) | Diagnóstico do app (2026-10-15): menu, dívida técnica e lista priorizada de melhorias. |

## Operação (herdado do upstream, ainda em uso)

Estes dois ficaram na raiz de `docs/` porque a instalação e o deploy dependem deles, mas foram escritos para o projeto original e não foram revisados para o Saiaê.

- [DATABASE_SETUP.md](./DATABASE_SETUP.md): banco de dados, Prisma e Docker Compose.
- [ENVIRONMENT_VARIABLES.md](./ENVIRONMENT_VARIABLES.md): variáveis de ambiente. As variáveis novas do Saiaê (IA, Cloud API, Comanda, Stripe, redes sociais) estão em `.env.example` e nos documentos de cada área acima.

## Referência da API

A documentação atual é o **Swagger UI**, no painel em `/swagger` (o link antigo `/docs` redireciona para lá). A especificação fica em `src/lib/swagger/`, com um arquivo por área em `paths/`, e é servida em `/api/docs`. Para documentar uma rota, edite o arquivo da área correspondente.

## Herdado do upstream (referência histórica)

Em [`upstream/`](./upstream/README.md): `API_DOCUMENTATION.md`, `API-QUICK-REFERENCE.md`, `API_ANALYSIS_REPORT.md`, `PROJECT_DOCUMENTATION.md`, `UPDATE_GUIDE.md` e `USER_GUIDE.md`. Podem estar desatualizados.
