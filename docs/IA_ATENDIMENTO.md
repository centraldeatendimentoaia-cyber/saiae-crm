# Atendente de IA no WhatsApp (fase 1)

Spec e plano: repositório da Comanda (`docs/superpowers/specs/2026-10-08-ia-whatsapp-design.md` e `.../plans/2026-10-08-ia-whatsapp.md`).
Esta página descreve só o que existe **no CRM**, tarefa a tarefa. **Tudo desligado por padrão** (`IA_ATENDIMENTO`).

## Tarefa 4: conversa, idempotência e consumidor de entrada

Módulo `src/modules/ia-atendimento/`, registrado no gancho `inbound-handler` do webhook da Meta **só com `IA_ATENDIMENTO=on`**.

O que o consumidor faz com cada mensagem recebida (nesta ordem):
1. **Idempotência:** o mesmo `messageId` nunca gera duas respostas (memória + coluna única `providerMessageId` no banco; a Meta reenvia).
2. **Rate limit por telefone:** 8 mensagens por minuto e 60 por hora; o excesso é descartado **sem resposta**.
3. **Opt-out:** quem mandou PARAR/SAIR não recebe mais nada (nem é gravado) até mandar VOLTAR.
4. **Grava a mensagem ANTES de responder:** é ela que abre a **janela de 24 h** da Cloud API (texto livre só dentro dela). Sem loja, a mensagem vai para a conversa "sem loja" (`SEM-LOJA`) **sem o conteúdo**.
5. **Loja:** o código `#K7P2QX` (6 caracteres, alfabeto sem 0/O/1/I/L) em qualquer posição do texto; senão, a loja da conversa mais recente do cliente; senão, orienta **uma vez por dia** a usar o link ou QR da loja (sem listar lojas).
6. **Tipos não suportados** (áudio, imagem, localização, etc.): pede texto, uma vez por hora.
7. **Pausa:** conversa em `humano` dentro de `pausadaAte` não é respondida pela IA (a retomada e o aviso ao dono são da Tarefa 7).
8. Chama o **`responder`** (motor da IA, Tarefa 6). **Sem `responder`, só registra e não responde nada.**

Ordem: mensagens de um lote são tratadas por timestamp. Uma mensagem com problema nunca derruba as outras. Texto cortado em 1000 caracteres.

### Dados (3 tabelas novas)
`IaConversa`, `IaMensagem` (retenção de **30 dias**, limpeza diária em `retention.ts`) e `IaConsumo` (usada na Tarefa 9).

> **ATENÇÃO: o CRM roda `prisma db push` em todo start.** Mergear o PR que traz estas tabelas e publicar **cria as três tabelas no banco de produção**. São só tabelas novas (nada existente muda), mas é mudança de produção: precisa do aval explícito do dono. Ver `CRM_SCHEMA_APLICA_NO_MERGE.md`.

### Limites que você precisa conhecer
- Idempotência, rate limit e "já orientado" ficam **em memória**; após um reinício, só a coluna única do banco continua barrando reentregas de mensagens já gravadas.
- Cliente identificado só por BSUID (telefone oculto) não recebe resposta ainda (o envio por BSUID não está implementado no `CloudApiProvider`).
- Logs: só contagens (`mensagens`, `ignoradas`, `limitadas`). **Nunca** telefone, nome ou texto.

### Variáveis
`IA_ATENDIMENTO` (`on` liga) e as da Cloud API (`WHATSAPP_CLOUD_SESSION_ID`, `META_WA_ACCESS_TOKEN`, `META_WA_PHONE_NUMBER_ID`). O envio usa a primeira sessão de `WHATSAPP_CLOUD_SESSION_ID`.

## Limite mensal e consumo (Tarefa 9)

- **Conta**: uma conversa = um cliente (telefone) numa loja, numa janela de 24 h, no mês de São Paulo (tabela `IaConsumo`, já existente). A contagem é feita pela primeira mensagem do cliente na janela, lendo `IaMensagem` (sem schema novo).
- **Limite**: vem de `plano_limite_conversas` do contexto da Comanda (mesma fonte da tela do dono; `null` = sem limite). Passou do limite: a IA só envia o link do cardápio (sem chamar o modelo) e o responsável recebe **um** aviso no mês (template `ia_chamar_dono`, sem pausar a conversa).
- **Aproximações da fase 1**: o "último limite visto" e o "já avisei este mês" ficam em memória (reiniciar o serviço apaga; pode repetir um aviso). Conversas em andamento quando o contador passa do limite também caem em "só link". Falha ao contar nunca silencia a IA.
- **Rota para a Comanda**: `GET /api/integracao/comanda/v1/ia-consumo?codigo_loja=XXXXXX`, cabeçalhos `X-Saiae-Timestamp` (segundos) e `X-Saiae-Signature = sha256=` + HMAC(`COMANDA_IA_SEGREDO`, `${timestamp}.${codigo_loja}`), janela de 5 min, lista de segredos para rotação. Resposta `200 {mes: "AAAA-MM", conversas, limite}` (`limite` = último limite visto, ou `null`; loja desconhecida = `0` e `null`). `401` e `400` (código inválido) sem corpo; `503` sem corpo se não houver segredo configurado.

## Pendências antes de abrir para clientes reais

- ~~Apagar conversas da IA quando o cliente apaga os dados na Comanda~~: feito, ver "Apagar conversas" abaixo.
- Teto global de respostas por dia e limite diário de avisos ao responsável: implementados (ver abaixo).

## Teto global de custo (`IA_MAX_RESPOSTAS_DIA`)

Kill-switch da plataforma: no máximo `IA_MAX_RESPOSTAS_DIA` respostas do modelo por dia (fuso de São Paulo, padrão **500**; valor ausente, inválido ou ≤ 0 usa 500), somando todas as lojas e valendo também para lojas sem limite de plano. Ao passar, a IA só manda o link do cardápio (sem chamar o modelo) e o responsável de cada loja recebe **um** aviso no dia (template `ia_chamar_dono`). O contador fica em `IaConsumo` (loja `GLOBAL`, período `ia:AAAA-MM-DD`). Falha ao contar não silencia a IA.

## Confirmação do WhatsApp do responsável

A IA só avisa (e só aceita "LIBERAR") o número do responsável depois que ele provar que é dele. Fluxo:

1. **Comanda → CRM**: `POST /api/integracao/comanda/v1/ia-dono-pedir-confirmacao` com `{"codigo_loja":"ABC234","telefone":"5561988887777"}` (telefone só dígitos com 55, vindo do banco da Comanda). Assinatura igual à do ia-contexto (`X-Saiae-Timestamp`, `X-Saiae-Signature = sha256=` + HMAC(`COMANDA_IA_SEGREDO`, `${timestamp}.${corpo}`), janela de 5 min, lista de segredos). O CRM envia o template `ia_chamar_dono` a **esse telefone** (a IA fica desligada até a confirmação, então o `ia-contexto` não serve para achar o número), com o motivo "confirmar este número como responsável da loja; responda CONFIRMAR #CODIGO". Resposta `200 {"enviado":true}` ou `200 {"enviado":false,"motivo":"sem_whatsapp"|"limite"|"falha_envio"}`; máximo de **3 pedidos por loja por dia** (contador em `IaConsumo`, chave `confirmar:AAAA-MM-DD`); `401`/`400`/`413`/`503` sem corpo.
2. **Dono → CRM**: o dono responde `CONFIRMAR #CODIGO` do próprio número. O CRM chama `COMANDA_IA_DONO_CONFIRMAR_URL` (edge function `ia-dono-confirmar`) com `{"codigo_loja","telefone"}` assinado como o ia-contexto. **Quem compara o número é a Comanda** (DDD + 8 últimos dígitos). Só com `200 {"confirmado":true}` o dono recebe "Número confirmado"; `{"confirmado":false,...}`, erro ou rede: nada é respondido nem revelado (a mensagem segue como de cliente comum).
3. Se o dono mudar o número na Comanda, a confirmação zera lá e a IA desliga.

Observação do template `ia_chamar_dono`: o texto fixo termina com "responda aqui: LIBERAR #{{4}}". Para o pedido de confirmação o motivo ({{2}}) já diz para responder CONFIRMAR; se a Meta aprovar, vale considerar um template próprio só de confirmação para não misturar as instruções.

## Apagar conversas (direito de apagar)

`POST /api/integracao/comanda/v1/ia-apagar-conversas` com `{"codigo_loja":"ABC234","telefone":"5561988887777"}` (telefone só dígitos, 10 a 13), chamada pela `cliente_apagar_dados` da Comanda. Assinatura igual à do ia-contexto (`X-Saiae-Timestamp`, `X-Saiae-Signature = sha256=` + HMAC(`COMANDA_IA_SEGREDO`, `${timestamp}.${corpo}`), janela de 5 min, lista de segredos). Apaga as conversas da IA desse telefone nessa loja (as mensagens saem em cascata) e também a conversa "sem loja" do mesmo telefone, considerando as formas com e sem o 9º dígito. **Sem o campo `telefone`** (exclusão de conta da loja) apaga TODAS as conversas da loja, inclusive de quem nunca pediu na Comanda; `telefone` presente porém inválido (ou vazio) é `400`, nunca vira exclusão em massa. Idempotente: `200 {"apagadas": n}`, inclusive `0`; `401`/`400`/`413`/`503` sem corpo. Nunca registra telefone nem código da loja. Não apaga o opt-out ("PARAR") do número, que é uma proteção do cliente.

## Atendente de vendas do Saiaê (mesmo número)

Ligada por `IA_VENDAS=on` (além de `IA_ATENDIMENTO=on`; padrão desligada). Roteamento no consumidor: mensagem com `#CODIGO` de loja vai para a loja; quem já está em conversa de loja continua nela; **sem código e sem conversa de loja** (ou com a mensagem do panfleto, que contém "panfleto"/"testador") vai para a atendente de vendas, que guarda a conversa como loja `VENDAS` (texto gravado, retenção de 30 dias). Quem está em vendas e escreve um `#CODIGO` passa para a loja. PARAR/VOLTAR valem para os dois. Com `IA_VENDAS` desligada tudo funciona como antes (orientação de usar o link da loja).

- Conhece só o que está em `vendas/conhecimento.ts` (ver `docs/conhecimento-saiae-vendas.md`); não fecha venda, não cobra, não promete desconto; transfere para a equipe com o mesmo mecanismo do `chamar_dono` (template `ia_chamar_dono` ao `IA_VENDAS_WHATSAPP_RESPONSAVEL`, pausa de 12 h, teto de 10 avisos por dia). A equipe devolve com `LIBERAR #VENDAS` (só vale do número configurado).
- Ferramentas: `enviar_link_cadastro` (o link sai de `IA_VENDAS_LINK_CADASTRO`, exemplo `https://saiae.com.br/raio-x`, nunca do modelo) e `chamar_humano`. `registrar_lead` vem no próximo PR.
- Defesas iguais às das lojas: entrada neutralizada, filtro de links (só o de cadastro passa), limite por telefone, janela de 24 h, só texto.
- Custo: teto diário próprio (`IA_VENDAS_MAX_RESPOSTAS_DIA`, padrão 100; contador `vendas:AAAA-MM-DD` na linha `GLOBAL` de `IaConsumo`, separado para ver quanto o panfleto gasta) e também vale o teto global `IA_MAX_RESPOSTAS_DIA`. Passou: só manda o link de cadastro e a equipe é avisada uma vez no dia.
**Template próprio (`IA_TEMPLATE_CONFIRMAR`)**: com a env definida (ex.: `ia_confirmar_responsavel`, utilidade, pt_BR, corpo "Olá! A loja {{1}} cadastrou este número como responsável pelo atendimento da IA no Sai aê. Para confirmar que o número é seu, responda aqui: CONFIRMAR #{{2}}. Se você não reconhece este pedido, ignore esta mensagem.") o pedido usa esse template com {{1}} = `nome_loja` (campo opcional do corpo da Comanda; sem ele, "sua loja") e {{2}} = código. Sem a env continua o `ia_chamar_dono`.

Observação (só vale sem a env) do template `ia_chamar_dono`: o texto fixo termina com "responda aqui: LIBERAR #{{4}}". Para o pedido de confirmação o motivo ({{2}}) já diz para responder CONFIRMAR; se a Meta aprovar, vale considerar um template próprio só de confirmação para não misturar as instruções.

### Lead da atendente de vendas

Cada contato de vendas vira um lead (tabela `IaLead`, um por telefone): `contactKey`, nome, tipo de negócio, cidade e origem (`panfleto` se a mensagem contiver "panfleto", senão `outro`). A ferramenta `registrar_lead` anota nome, negócio e cidade só com o que a pessoa disse (cada campo: uma linha, até 80 caracteres, sem controles). **Nunca guarda o texto da conversa** (as mensagens seguem a retenção de 30 dias). O lead sai junto quando a Comanda chama `ia-apagar-conversas` com o telefone da pessoa (a exclusão da loja inteira, sem telefone, não mexe em leads). Para ver os leads, hoje só pelo banco (`IaLead`); uma tela fica para depois.

**Privacidade (a fazer fora do código)**: a Política de Privacidade do Saiaê precisa citar os leads vindos do panfleto/WhatsApp (o que se guarda: telefone, nome, tipo de negócio e cidade informados pela própria pessoa; para quê: retomar o contato comercial; como pedir a exclusão). Guardar o telefone no lead está **pendente de aprovação do João**; a exclusão é feita pela rota `ia-apagar-conversas` com o telefone.
