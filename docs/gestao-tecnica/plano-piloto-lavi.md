# Plano de piloto LAVI: validação operacional antes de clientes externos

Objetivo: provar, em staging e depois na operação real da LAVI Concept, que automações, gatilhos, importação de agenda e painel de resultados funcionam e medem sem inventar números, ANTES de oferecer a qualquer cliente externo. Este documento é um plano: nada aqui foi executado. Papéis: **João** decide todas as etapas marcadas "Decide: João"; o agente técnico executa e registra evidências.

## 1. Pré-requisitos (todos precisam estar OK; nenhum foi verificado neste sprint)

| # | Pré-requisito | Como comprovar | Decide |
|---|---|---|---|
| P1 | Backup do banco de staging feito e restauração testada | arquivo de backup datado + restauração num banco descartável com contagem de linhas igual | João |
| P2 | Schemas aditivos aplicados SÓ em staging, após revisão do SQL: `ScheduledMessageAttempt`, `ExternalPostLink`, `AutomationFlow`, `AutomationFlowVersion`, `AutomationRun`, `AutomationStep`, `AutomationTriggerEvent`, `ResultEvent` | `SHOW TABLES` lista as tabelas; app sobe sem erro; nenhuma tabela existente alterada (diff de `information_schema`) | João |
| P3 | Variáveis de staging separadas das de produção (banco, tokens, `NEXTAUTH_URL`) | conferência visual do João no painel, sem imprimir segredos | João |
| P4 | Flags desligadas por padrão: `AUTOMACOES_ATIVAS` e as 4 `AUTOMACOES_GATILHO_*` | `GET /api/automacoes/gatilhos/diagnostico` mostra `desabilitado_flag` nos 6 gatilhos | agente |
| P5 | Permissões Meta: App Review aprovado para `instagram_manage_messages`, `instagram_manage_comments`, `pages_messaging`, `pages_read_user_content`, `pages_manage_metadata`; contas reconectadas com os novos escopos | painel da Meta (print do João) + diagnóstico mostrando `bloqueado_permissao` sumir | João (Meta) |
| P6 | Webhook `/api/social/webhook` cadastrado no app Meta de TESTE com `SOCIAL_WEBHOOK_VERIFY_TOKEN` e `SOCIAL_META_APP_SECRET` só no staging | verificação do webhook retorna o challenge | agente |
| P7 | Provedor de envio Instagram/Messenger no executor implementado e revisado (hoje inexistente: gatilhos sociais não podem ser ligados) | revisão independente + teste com provedor fictício | João decide prosseguir |
| P8 | Conta de teste da Meta e número WhatsApp próprio do João/equipe como destinatários; nenhum cliente real | lista nominal dos destinatários | João |
| P9 | Credenciais do incidente (`incidente-credenciais.md`) tratadas | decisão registrada do João | João |

Sem P1 a P4 o piloto não começa. P5 a P7 só são necessários para as etapas sociais (etapa 6).

## 2. Roteiro em staging

Cada etapa só começa quando a anterior cumpre seus critérios. Registrar data, evidência (print/log sem segredo) e resultado.

1. **Subir o staging** com os schemas de P2. Critério: `/dashboard/metricas`, `/dashboard/automacoes`, `/dashboard/resultados` abrem sem erro 5xx.
2. **Painel de resultados com dados vazios e reais de WhatsApp.** Abrir `/dashboard/resultados` num período sem dados: mensagem de vazio, sem erro. Num período com conversas: conferir manualmente 10 contatos amostrados (lead, conversa, resposta) contra o chat. Critério: 10 de 10 batem.
3. **Origem.** Conferir 10 conversas: as vindas de anúncio (marcador) aparecem como Anúncio confirmado; as sem marcador, Orgânico inferido; as sem nada, "Origem não identificada". Critério: nenhuma origem exibida como confirmada sem marcador; contagem de desconhecidos igual à contagem manual.
4. **Importação de agenda com arquivo sintético** (`tipo;contato;ocorrido_em;origem;campanha;referencia;valor`): importar, conferir contagens; importar de novo (novos = 0); importar arquivo com 5 linhas inválidas (rejeitadas com número da linha). Depois importar uma exportação REAL da agenda da LAVI (só o João autoriza) e comparar o total de comparecimentos do painel com a agenda: diferença aceita = 0 para linhas válidas.
5. **Isolamento.** Com dois usuários de teste e duas sessões: o usuário B recebe 403 em `/api/resultados/<sessão de A>` e na importação; o painel de B não mostra eventos de A. Critério: 0 vazamentos.
6. **Automações e gatilhos (só com P5 a P8).** Fluxo de teste (texto, espera, etiqueta) iniciado manualmente para o número de teste; depois UMA flag por vez (DM, comentário), com conta de teste. Critério: cada evento dispara 1 vez (sem duplicata em reentrega do webhook), respeita opt-out "SAIR", respeita janela de 24 h/7 dias.
7. **Exportação CSV**: abrir no Excel; célula iniciada por `=`, `+`, `-`, `@` aparece como texto. Critério: nenhuma fórmula executada.
8. **Observação de 7 dias** com flags de automação ligadas só para a conta de teste. Critério: ver métricas de sucesso.
9. **Revisão final** com o João: lista de falhas, decisão de expandir ou não.

## 3. Critérios de aceite (objetivos)

- 0 vazamentos entre usuários/sessões nos testes da etapa 5.
- 100% dos 10 contatos amostrados batem (etapas 2 e 3); qualquer divergência vira correção antes de seguir.
- Importação idempotente: 2ª importação do mesmo arquivo = 0 novos.
- 0 mensagens enviadas a quem pediu "SAIR" e 0 mensagens duplicadas por evento no período de observação.
- 0 erros 5xx nas rotas novas no log do staging durante a observação.
- Painel nunca exibe origem "confirmada" sem marcador autoritativo e sempre exibe a contagem de "origem não identificada".

## 4. Métricas de sucesso do piloto

| Métrica | Meta mínima | Fonte |
|---|---|---|
| Leads com origem identificada (confirmada ou inferida) | acompanhar e registrar (linha de base); meta definida pelo João após a 1ª semana | painel |
| Conversas respondidas / conversas iniciadas | igual ou melhor que a semana anterior sem automação | painel + `/dashboard/metricas` |
| Tempo mediano da primeira resposta | não pior que a linha de base | `/dashboard/metricas` |
| Comparecimentos conferidos com a agenda | 100% das linhas importadas | agenda da LAVI |
| Incidentes (envio indevido, duplicado, vazamento) | 0 | log + relato da equipe |

Nenhuma meta de conversão ou receita é prometida: sem evidência de causa, o painel só descreve o que aconteceu.

## 5. Riscos

- Origem inferida confundida com prova: mitigado pelos rótulos, mas a equipe precisa ler "inferido" como hipótese.
- Cliente antigo contado como lead se o histórico de mensagens foi apagado pela retenção.
- Contato da planilha não casar com o jid do WhatsApp (telefone sem 55, 9º dígito, LID): eventos importados ficam sem origem ou fora do funil por contato.
- Schema aplicado em banco errado: o Dockerfile roda `prisma db push` a cada start. Aplicar só após P1 e revisão.
- Gatilhos sociais sem provedor de envio: ligar flag sem P7 não envia nada, mas gera eventos reservados.
- Dependência do App Review da Meta (prazo fora do nosso controle).
- Reentrega de webhook ou execução em duas instâncias sem teste real de concorrência (reserva atômica só testada com Prisma simulado).

## 6. Plano de reversão

- **Flags**: desligar `AUTOMACOES_ATIVAS` e as `AUTOMACOES_GATILHO_*` (efeito imediato após reinício; nada novo é enviado).
- **Código**: reverter os commits do Sprint 7 remove painel, rotas e menu; os dados importados ficam inertes.
- **Dados**: `ResultEvent` só tem linhas importadas; para desfazer uma importação errada, apagar por `fonte` e intervalo de `createdAt` em staging (com backup). Não há rotina pronta: criar script revisado se for necessário.
- **Schema**: tabelas novas são aditivas; não remover enquanto houver dados. Em último caso, restaurar o backup de P1.
- **Comunicação**: se houver envio indevido, parar flags, avisar o João e registrar incidente.

## 7. Quem decide cada etapa

| Decisão | Responsável |
|---|---|
| Aplicar schema em staging / produção | João |
| Autorizar uso de exportação real da agenda | João |
| Ligar cada flag, uma por vez | João (executa o agente) |
| Pedir App Review / reconectar contas Meta | João |
| Considerar o piloto aprovado e abrir para clientes externos | João, com base nos critérios da seção 3 |
| Correções técnicas e revisão independente | agente técnico + revisor |

Clientes externos só entram após: critérios da seção 3 cumpridos, 7 dias sem incidente, isolamento por empresa testado com dados de duas empresas e decisão escrita do João.
