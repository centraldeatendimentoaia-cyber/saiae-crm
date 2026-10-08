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
