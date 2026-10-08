# Atendente de IA no WhatsApp: contexto da Comanda (Tarefa 5)

Spec e plano: repositório da Comanda (`docs/superpowers/specs/2026-10-08-ia-whatsapp-design.md` e `.../plans/2026-10-08-ia-whatsapp.md`). Visão geral das tarefas do CRM: `IA_ATENDIMENTO.md`.

## Tarefa 5: cliente do contexto da Comanda (`comanda-contexto.ts`)

`buscarContexto(codigoLoja, telefone)` chama `POST {COMANDA_IA_URL}` (função `ia-contexto` da Comanda, contrato **SAI-002**: `docs/contrato/v1/ia-contexto.md` no repositório da Comanda) e devolve os dados reais da loja, do cardápio e, se o telefone for de um cliente com perfil confirmado, o primeiro nome e os itens dos últimos pedidos. **Somente leitura.**

- **Assinatura:** `X-Saiae-Signature = "sha256=" + HMAC-SHA256(COMANDA_IA_SEGREDO, timestamp + "." + corpo)`; `X-Saiae-Timestamp` em segundos. O corpo assinado é exatamente o enviado: `{"codigo_loja":"K7P2QX","telefone":"5561999990001"}`.
- **Validação da resposta (zod):** resposta fora do contrato vira `{ ativa: false }`. Campos a mais são aceitos (contrato aditivo); `grupo.tipo` e `bairro_nao_listado` ausentes usam o padrão. Textos são **cortados** (texto livre do dono em 2000 caracteres): defesa contra prompt gigante.
- **Falhas viram `{ ativa: false }`** (a IA fica calada em vez de inventar): sem `COMANDA_IA_SEGREDO`/`COMANDA_IA_URL`, código de loja inválido (nem chama a Comanda), HTTP não-200, rede, **timeout de 8 s** e resposta fora de forma. Nunca lança.
- **Cache de 60 s** por loja + telefone (só dígitos). Respostas de falha **não** vão para o cache. O cache nunca mistura telefones.
- **Cliente com telefone oculto (BSUID) ou número inválido:** chama a Comanda **sem** o campo `telefone` (`{"codigo_loja":"K7P2QX"}`); a loja e o cardápio vêm normalmente e `cliente` é sempre `null` (a IA atende como cliente novo e leva ao link do cardápio). **A Comanda precisa aceitar `telefone` ausente**; se responder erro, a IA fica calada.
- **Log:** só o motivo (HTTP, rede, timeout, fora do contrato). **Nunca** telefone, corpo, segredo nem conteúdo da resposta.

Variáveis (Railway, definidas pelo dono): `COMANDA_IA_SEGREDO` (= `IA_CONTEXTO_SEGREDO` da Comanda; segredo de plataforma, nunca no chat) e `COMANDA_IA_URL` (`https://<projeto>.supabase.co/functions/v1/ia-contexto`).
