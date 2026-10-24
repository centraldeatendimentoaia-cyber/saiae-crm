# Disparos e avaliação pelo WhatsApp da barraca (Baileys)

O dono da loja dispara "reativar quem sumiu" e "promoção do dia" pelo WhatsApp da própria loja, e cada pedido entregue pode gerar um pedido de avaliação (nota de 1 a 5). Tudo com descadastro, tetos e fila. Construído sobre a mesma sessão por QR dos avisos de pedido (ver [whatsapp-avisos-baileys.md](./whatsapp-avisos-baileys.md)).

Divisão de responsabilidades: o Sai aê decide o público (somente clientes que consentiram) e só envia a campanha ao CRM quando o dono confirma. O CRM é dono da fila, dos tetos, do "SAIR" e do envio. O CRM nunca lê o banco do Sai aê. Nenhum disparo sai sozinho; a avaliação é follow-up do pedido e fica desligada por padrão.

## ATENÇÃO: o deploy cria tabelas

O CRM roda `prisma db push` em todo start. Publicar esta mudança cria três tabelas novas: `DisparoCampanha`, `DisparoEnvio` e `AvaliacaoPedido`. Nenhuma tabela existente é alterada. Não há variável de ambiente nova obrigatória (usa `COMANDA_WHATSAPP_SEGREDO` e `SAIAE_INTEGRACAO_V1_URL`, os mesmos dos avisos e do bot).

## Rota

`POST /api/integracao/comanda/v1/whatsapp-disparos`. Pública em `src/proxy.ts` (caminho exato). Mesma autenticação e ordem de checagens de `whatsapp-conexao`: 503 sem segredo, 413 acima de 262144 bytes (também por `content-length`), 401 idêntico para qualquer falha de assinatura ou janela de 5 minutos, 400 JSON inválido, 422 fora do contrato (corpo `strict`, `X-Saiae-Event-Id` diferente de `request_id`), 429 acima de 30 chamadas por minuto por loja, depois a ação. Falha interna: 502 genérico.

Campos comuns: `barraca_id` (uuid), `request_id` (uuid), `acao`.

- `criar`: `tipo` (`promocao` | `reativacao`), `texto` (1 a 600), `barraca_nome` (1 a 80), `destinatarios` (1 a 500 de `{ telefone: 8 a 15 dígitos, nome: até 60 | null }`).
  - 200 `{ ok: true, campanha_id, total, invalidos, repetido }`. `total` = destinatários únicos aceitos. O mesmo `request_id` devolve a campanha original com `repetido: true`, sem novos envios.
  - 200 `{ ok: false, motivo }`, com `motivo` em `whatsapp_desconectado`, `campanha_em_andamento`, `limite_campanhas_dia` ou `sem_destinatarios_validos`.
- `historico`: 200 `{ ok: true, campanhas: [{ id, tipo, estado, criada_em, total, enviados, falhas, pulados, na_fila }], avaliacoes: { media, total, enviadas_30d, itens: [{ pedido_id, nota, comentario, em }] } }` (até 10 campanhas e 20 notas, mais recentes primeiro). Estado da campanha: `em_andamento` | `concluida` | `cancelada` | `expirada`.
- `cancelar`: `campanha_id`. 200 `{ ok: true, cancelados }`. Só os itens `pendente` da campanha DA LOJA do corpo; campanha de outra loja devolve `cancelados: 0`.

## Regras de campanha

- **Público**: o app envia os destinatários. O CRM normaliza (`55` + DDD), remove repetidos e inválidos (conta em `invalidos`).
- **Rodapé obrigatório**: toda mensagem termina com `Para não receber mais mensagens, responda SAIR.` O app não consegue removê-lo; se o dono já escreveu a mesma frase, ela não é duplicada. `{nome}` sem nome cadastrado some junto do espaço antes dele (sem "Olá !").
- **Descadastro**: quem respondeu SAIR depois de a campanha ser criada não recebe: a checagem é feita na hora do envio.
- **Tetos**: 1 mensagem de campanha por cliente por 24 h por loja (qualquer campanha); 2 campanhas criadas por loja por 24 h; 1 campanha em andamento por loja; 3 envios por minuto e 150 por dia por número (20 por dia na primeira semana do vínculo); pausa aleatória de 8 a 25 s entre envios. Avisos de pedido têm tetos próprios e não contam nos de campanha.
- **Janela**: só entre 09:00 e 20:00 (America/Sao_Paulo, fuso fixo UTC-3, independente do servidor). Fora dela o envio espera a próxima 09:00.
- **Validade**: campanha não enviada em 24 h expira. Sessão desconectada: o item espera 60 s por tentativa; chegando ao fim da validade vira `pulado_desconectado`. Nada acumula além de 24 h.
- **Falha de envio**: 2 retentativas (30 s e 5 min), depois `falhou`; número sem WhatsApp vira `falhou` com `numero_sem_whatsapp`, sem retentativa.
- **Ordem de decisão por envio**: campanha cancelada, expirada, fora da janela, sessão desconectada, teto por minuto ou dia, descadastro, já recebeu nas últimas 24 h, envio.
- **Estados do envio**: `pendente`, `enviado`, `falhou`, `pulado_optout`, `pulado_limite_diario`, `pulado_desconectado`, `cancelado`, `expirado`.

## Avaliação pós-entrega

- **Gatilho**: `order.status_changed` com `status = entregue`. Agenda o envio para 30 min depois, uma vez por pedido (restrição única `(barraca, pedido)`: evento repetido ou nova entrega depois de correção não duplica). Pedido que já nasce entregue (`order.created` com `status = entregue`, entrega direta no balcão) ocupa a chave como `pulada_desativada` com motivo `nasceu_entregue`. Sem telefone: `pulada_sem_telefone`.
- **No envio** (config lida do Sai aê pela ação `avaliacao_config` na hora do envio): config fora do ar adia 5 min e, passadas 6 h, vira `falhou`; avaliação desligada ou módulo desligado vira `pulada_desativada`; pedido com aviso `cancelado` vira `pulada_cancelado`; descadastrado vira `pulada_optout`; sessão desconectada adia (6 h depois, `pulada_desconectada`); fora das 09:00 a 20:00 espera; usa os tetos e a pausa dos avisos de pedido (somando avisos e avaliações). Texto: o da loja ou `Olá {nome}! Como foi seu pedido {senha} na {barraca}? Responda com uma nota de 1 a 5 (5 = ótimo) e, se quiser, deixe um comentário.`
- **Resposta** (lida em `bot-pedidos/entrada.ts`, ANTES do bot): vale por 48 h depois do envio e casa pelos últimos 8 dígitos do telefone, na avaliação enviada mais recente da loja da sessão. Só vira nota `N`, `nota N`, `N estrelas` ou `N` seguido de espaço ou pontuação e comentário (N de 1 a 5). "Quero 2 pizzas", "2x yakisoba", "10", "0", "6" e "4,5" não são nota. Se o bot de pedidos está no meio de um pedido com o contato, a mensagem segue para o bot e a avaliação continua aberta.
- **Depois da nota**: grava nota e comentário (até 300 caracteres), agradece ao cliente (nota 3 ou mais: "Obrigado pela avaliação!"; nota 1 ou 2: avisa que o responsável vai falar com ele), e manda ao WhatsApp do dono (`whatsapp_dono` da config) o primeiro nome, a senha, a nota e o comentário; nota 1 ou 2 leva o prefixo "ATENÇÃO:". Sem WhatsApp do dono, a avaliação é registrada e aparece no histórico, sem erro. Só uma nota por pedido (atualização condicional em `enviada`).
- **Estados**: `agendada`, `enviada`, `respondida`, `expirada` (48 h sem resposta), `falhou`, `pulada_sem_telefone`, `pulada_desativada`, `pulada_optout`, `pulada_cancelado`, `pulada_desconectada`.

## Privacidade

- Telefone e nome ficam no banco só enquanto o item está pendente (campanha) ou aguardando resposta (avaliação); depois o campo `payload` é apagado. A campanha guarda `chave = sha256(barracaId:telefone)` para o teto diário, sem o telefone.
- O comentário da avaliação (até 300 caracteres) fica no CRM e só é mostrado ao dono da loja, pelo histórico.
- Logs e motivos usam só códigos fixos: nunca telefone, nome, texto de mensagem nem comentário.

## Decisões de segurança tomadas na implementação

- "Conversa aberta" do bot (que impede "5" de virar nota): rascunho vigente, resumo aguardando o "sim", ou troca de mensagens com o bot nos últimos 15 minutos. Conversa antiga sem pedido em andamento não bloqueia a avaliação.
- `request_id` já usado por OUTRA loja devolve `campanha_em_andamento`, nunca a campanha dela.
- Item adiado nunca é agendado para depois do fim da validade da campanha, para ser marcado como `expirado` a tempo.
- Lote do worker de campanhas é de 5 itens: cada envio espera de 8 a 25 s, então um ciclo já dura minutos.
- Campanha esquecida em `em_andamento` há mais de 24 h aparece como `expirada` no histórico mesmo antes de o worker fechá-la.
- O payload apagado usa `Prisma.DbNull` (o Prisma não aceita `null` simples em campo Json).

## Limites honestos

- O Baileys não é oficial: o WhatsApp pode bloquear o número que dispara. Os tetos, a janela e o descadastro reduzem o risco, não o eliminam. A loja responde pelo conteúdo e pelo público.
- Não existe registro de reclamação no Sai aê: a regra de "não pedir avaliação de pedido com problema" é "sem cancelamento". Pedido entregue com reclamação por outro canal ainda recebe o pedido de avaliação.
- A resposta "5" logo depois de o cliente ter outro assunto com a loja (e sem conversa com o bot) é lida como nota.
- Segunda resposta com nota, depois de a primeira ter sido gravada, segue para o bot como mensagem comum.
- Estado do bot (conversa aberta) é em memória: some se o CRM reiniciar.

## O que não existe

- Avaliação no Google (Google Avaliações / Google Meu Negócio).
- Cobrança do módulo (a flag `whatsapp_disparos_habilitado` fica no app e só a plataforma altera).
- Envio de campanha por template oficial (Cloud API).
- Agendamento de campanha para data futura e segmentação além de "reativar" e "promoção".
