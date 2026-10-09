# CRM: alterar o schema = aplicar em produção no próximo deploy

**Descoberto em 07/10/2026.** Leia antes de mergear qualquer PR que mexa em `prisma/schema.prisma`.

## O fato

O CRM **não tem pasta de migrations**. O schema chega ao banco por `prisma db push`, e o `Dockerfile`
roda esse comando **em todo start do container**:

```
CMD ["sh", "-c", "npx prisma db push && ... node ... src/server/index.ts"]
```

(O `start.sh`, usado fora do Railway, também roda `npx prisma db push`.)

Consequência direta:

> Mergear na `main` um PR que altera `prisma/schema.prisma` e deixar o Railway publicar **aplica a
> alteração no banco de produção**, sem nenhum passo separado e sem aprovação adicional.

## Por que isso importa

- Mudança **aditiva** (coluna nullable, tabela nova) costuma ser segura, mas **continua sendo mudança em produção**.
- Mudança **destrutiva** (remover coluna, mudar tipo, tornar coluna obrigatória) faz o `db push` **recusar**
  sem `--accept-data-loss`. Como o `&&` aborta, **o container não sobe**: o serviço cai no deploy.
- Não há como "preparar" uma migration e aplicar depois: merge e aplicação são o mesmo evento.
- Não existe histórico de migrations nem reversão automática. Reverter = outro `db push` com o schema antigo,
  que **não** devolve dados apagados.

## Regra de trabalho (vale para agentes e pessoas)

1. PR que muda o schema leva **aviso no topo** ("MERGE APLICA NO BANCO DE PRODUÇÃO NO PRÓXIMO DEPLOY").
2. A mudança de schema fica **isolada em um commit só**, para ser revista à parte.
3. **Só mergear com aval explícito do dono**, sabendo que o deploy seguinte já cria a coluna/tabela.
4. Antes: backup recente (existe o serviço `backup` diário, ver `DEPLOY-RAILWAY.md`) e conferir o SQL que será aplicado:
   `npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script`
   (somente leitura; imprime o SQL, não executa).
5. Nunca incluir mudança destrutiva sem plano de dados escrito.

## Proposta de proteção (Draft PR, **não ativa** até o dono decidir)

Interruptor `PRISMA_DB_PUSH` no `Dockerfile`:

| Valor | Efeito no start |
|---|---|
| ausente, `on` ou qualquer outro | **igual a hoje**: roda `prisma db push` (e aborta o start se ele falhar) |
| `off` (exatamente) | **não** roda `db push`; registra uma linha de log e segue subindo o servidor |

O **padrão não muda nada**: mergear a proposta não altera o comportamento em produção. Só passa a proteger
quando o dono definir `PRISMA_DB_PUSH=off` no Railway.

Com `off`, o fluxo de uma mudança de schema vira:

1. Mergear o PR (o deploy sobe **sem** tocar no banco; o código novo deve tolerar a coluna ausente, ou o PR deve ser compatível nos dois estados).
2. Conferir o SQL com `prisma migrate diff` (item 4 acima) e fazer backup.
3. Com o aval do dono, aplicar **uma vez**, à mão: `npx prisma db push` num shell do Railway (ou um deploy com `PRISMA_DB_PUSH=on` por um start).

Limites da proposta, ditos com franqueza:
- O desvio no `Dockerfile` foi validado só pelo comportamento do comando de shell (com `npx`/`node` de mentira, nos casos
  ausente, `on`, `off`, valor inválido e falha do push) e pela sintaxe. **Não foi construído nem executado em container.**
- Com `off`, o código que depende de coluna nova **quebra** se for publicado antes de o schema ser aplicado. Isso exige disciplina de ordem.
- O caminho robusto a longo prazo é adotar `prisma migrate` (migrations versionadas e `migrate deploy`), o que
  exige **baseline** do banco atual e é uma mudança maior, a combinar com o dono. Não está nesta proposta.

## Estado atual das mudanças de schema planejadas

Nenhuma. Decisão de 07/10/2026: o piloto da Cloud API **não mexe no schema**. A escolha da sessão é por
`WHATSAPP_CLOUD_SESSION_ID` (ver `CLOUD_API_PILOTO.md`). Quando a IA precisar de texto livre, abrir um PR
**de schema** seguindo a regra acima: tabela da "última mensagem do cliente" por sessão e contato
(`contactKey` = telefone, senão BSUID) e, depois, coluna `provider` em `Session`.
