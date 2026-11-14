# Sprint 4 (Agência + CRM): relatório

Branch `feat/sprint4-agencia-crm`, base `48cb963` (produção). Dois commits locais, sem push: `9ddf389` (`db:`, schema) e `781f747` (código, testes). Nada foi publicado, agendado, implantado nem enviado à Meta; nenhum `prisma db push/migrate` foi rodado; nenhum segredo foi lido.

## 1. Itens: causa/lacuna, solução, arquivos

### 1.1 Bloqueio editorial (achado 8)
- Lacuna: `PATCH /api/social/posts/:id` com `publishAt` põe qualquer rascunho em `PENDING`; o CRM não conhecia estado editorial.
- Solução mínima: o estado editorial vive no vínculo externo (`ExternalPostLink.editorial`). `PATCH` com `publishAt` recusa com `409 {codigo:"editorial_bloqueado"}` se o post tem vínculo com `editorial != "aprovado"`. Quando a agência reenvia a peça como reprovada, bloqueada pelo lint ou pendente, o vínculo é travado e um post já `PENDING` volta a `DRAFT` sem data. Rede de segurança: `publishOne` (agendador) não publica post cujo vínculo esteja bloqueado. Post criado manualmente não tem vínculo e segue exatamente como antes (teste de regressão). Nova versão aprovada (versão maior) destrava.
- Arquivos: `src/app/api/social/posts/[id]/route.ts` (+1 import, +5 linhas), `src/modules/social/scheduler.ts` (+2 linhas), `src/modules/social/importar-pacote.ts` (`bloqueioEditorial`, `revogar`).

### 1.2 Endpoint de importação idempotente (achado 9)
- `POST /api/social/importar-pacote`: multipart (`manifesto` JSON + um arquivo por `midias[].ref`, ou `nome` se não houver `ref`) ou JSON puro (só útil em `validar`). Autenticação `x-api-key` existente, tudo por `userId`.
- Validação do lote (recusa tudo, nada gravado): `contrato`, `cliente`, `semana`, 1 a 60 peças, e `contas.padrao` (+ `carrossel`/`stories` opcionais) precisam ser contas `instagram` do dono da chave; senão `404 conta_nao_encontrada`.
- Por peça (falha isolada): `status_nao_aprovado`, `lint_com_erro` (lint ausente conta como erro), `formato_nao_suportado` (reel), `hash_invalido` (o servidor recalcula o hash), `legenda_longa`, `midia_invalida` (arquivo ausente, mime, 5 MB, sha256 diferente do arquivo, regras de 1 a 10 imagens e story com 1, reaproveitando `parseContent`), `quota_midia` (`quotaMidiaBytes`), `versao_antiga`, `conflito_publicado`, `item_invalido`.
- Idempotência: chave `cliente:semana:slug`. Mesmo hash: `inalterado` (sem tocar em nada, nem mídia). Hash novo e versão maior com post `DRAFT`/`PENDING`: `atualizado` (mídias novas, as antigas removidas, post volta a `DRAFT` sem data para um humano reaprovar). Hash novo e versão menor ou igual: `versao_antiga`. Post em `PUBLISHING/PUBLISHED/FAILED/PAUSED`: `conflito_publicado`.
- Sempre `DRAFT`, `publishAt` nulo; data+hora planejadas (Brasília, UTC-3) vão para `ExternalPostLink.plannedAt`. Legenda final = legenda + linha em branco + hashtags. Story descarta a legenda e devolve aviso. Mídia reaproveita `mediaStorage.save` e `ensurePublicTokens` (mesma quota e URL pública do upload existente).
- Resposta: `lote`, `resumo`, e por item `externalKey`, `resultado`, `postId`, `groupId`, `mediaIds`, `estado`, `urlPainel`, `avisos` ou `erro{codigo,mensagem}`. Modo `validar` (padrão) roda tudo sem gravar.
- Schema: tabela nova `ExternalPostLink` (commit `db:`), apenas aditiva; `ScheduledPost` e `MediaFile` não mudaram.
- Arquivos: `src/modules/social/importar-pacote.ts`, `src/app/api/social/importar-pacote/route.ts`, `prisma/schema.prisma`.

### 1.3 Retorno de estado
- `GET /api/social/importar-pacote/estado?keys=a,b` ou `?cliente=lavi&semana=2026-S47`: por chave devolve versão, hash, estado editorial, `postId`, `groupId`, `mediaIds`, `estado` (`DRAFT|PENDING|PAUSED|PUBLISHING|PUBLISHED|FAILED|REMOVIDO`), `plannedAt`, `publishAt`, `releaseId`, `releaseUrl`, `publishedAt`, `erro`, `urlPainel`. Só enxerga vínculos do próprio `userId`. Arquivo: `src/app/api/social/importar-pacote/estado/route.ts`.

### 1.4 Lado agência (`D:\agencia-marketing`, sem commit, nenhum arquivo existente alterado)
Três arquivos NOVOS em `scripts/`:
- `gerar_manifesto.py <cliente> <semana>`: lê `pacote/agendamento.csv` e as pastas de post (somente leitura), gera `pacote/manifesto.json` no contrato. Só linhas `aprovado`; calcula sha256 das mídias e o hash da peça (mesmo algoritmo do CRM, com vetor comum nos dois testes); não sobrescreve (exige `--atualizar`, que sobe a `versao` só das peças cujo hash mudou); `--saida` escolhe outro destino.
- `enviar_crm.py enviar|estado`: monta o multipart e chama o CRM. Por padrão é simulação (não toca a rede); `--enviar` faz o envio; sem `--importar` o modo é `validar`. A chave vem só de `CRM_API_KEY` e nunca é impressa. Grava o retorno em `pacote/importacao-crm.json` sem sobrescrever. Não foi executado envio real.
- `test_gerar_manifesto.py`: 5 testes `unittest` com fixtures sintéticas em pasta temporária.
- Como usar (staging, sem publicar): ver seção 5.

### 1.5 Testes
`src/modules/social/importar-pacote.test.ts`, 22 testes, banco em memória e fixtures sintéticas do piloto LAVI: importar (mídia, conta, horário, ids); `validar` sem gravar; reimportar idêntico (zero duplicata, inclusive mídia); nova versão (mesmo post, mídia trocada); versão antiga; conflito com post publicado; reprovado, pendente, bloqueado e lint com erro recusados com código; mídia faltando e adulterada; hash adulterado, reel, legenda longa; story; conta de outro usuário, facebook e inexistente recusam o lote; sem autenticação (401); chave de outro usuário não vê o vínculo e a mesma chave externa em outro usuário não colide; impossibilidade de agendar reprovado (e lint, e agendado que volta a rascunho); destrava com versão nova aprovada; agendador não publica peça bloqueada; regressão do fluxo manual; vetor de hash igual ao do Python.

## 2. Resultados reais
| Verificação | Resultado |
|---|---|
| `npm ci` | ok (622 pacotes) |
| `npx prisma generate` | ok |
| `npx prisma validate` (com `DATABASE_URL` fictícia) | schema válido |
| `npm run typecheck` | `tsc --noEmit`: sem erros |
| `npm test` (suíte completa) | 129 arquivos, 2178 testes passaram (22 novos) |
| Lint nos arquivos alterados/novos | 0 problemas. A pasta `src/modules/social` já tinha 4 erros `no-explicit-any` em `social.test.ts` e outros arquivos `api/social` fora do escopo (pré-existentes, não tocados) |
| `npm run build` (env fictício só no processo) | build concluído e rotas listadas. Aparecem logs `prisma:error` porque algumas páginas tentam consultar o banco fictício no build (comportamento preexistente, não bloqueia) |
| Python `py -m unittest scripts/test_gerar_manifesto.py` | 5 de 5 ok |
| Leitura real LAVI 2026-S47 (só leitura, saída em pasta temporária) | manifesto com as 9 peças aprovadas (7 stories, 2 carrosséis, 4 slides cada) no formato certo; nada gravado no repositório da agência |

## 3. Não verificado
- Nenhum teste contra MySQL real, Next em execução ou staging: os testes usam banco em memória e chamam os handlers diretamente. Comportamento real de `request.formData()` com PNGs grandes, tamanho de corpo máximo da plataforma (Railway/Next) e tempo de upload de ~9 peças não foram medidos.
- A tabela `ExternalPostLink` nunca foi aplicada a um banco; só `prisma validate` e `generate`.
- Conferência cruzada do `handle` do CTA com `SocialAccount.username` (contrato 3.6) não foi feita; a fronteira de tenant é só a chave de API.
- Unicidade concorrente (duas importações simultâneas da mesma chave): coberta por desfazimento no erro de unicidade (tratamento no código, simulado no banco em memória), não testada em banco real.
- O MCP `saiae-crm` e o escritório de IA não foram tocados nem adaptados.

## 4. Riscos e limites
- Schema: ver seção 6. Com `prisma db push` em todo start, o merge cria a tabela em produção no próximo deploy.
- Atualização de peça sobrescreve legenda e mídia do rascunho; se alguém editou o rascunho à mão no CRM, a nova versão da agência vence (post volta a `DRAFT`).
- `lint.erros` e o status vêm da agência (CSV); o CRM confia no manifesto. O `revisao.md` (reprovação textual) não é lido pelo gerador: reprovação do revisor só chega ao CRM se o CSV deixar de dizer `aprovado` e a peça for reenviada com `--incluir-nao-aprovados` (para revogar um vínculo já existente). Decisão de processo pendente com o João.
- Chave de API continua dando acesso total ao usuário; o bloqueio editorial é de cliente honesto (quem tem a chave pode, por outra rota, criar post novo agendado). Ele protege peça importada, não o CRM inteiro.
- Mídias: cada importação nova de versão grava as imagens de novo (sem dedupe por checksum) e remove as antigas; respeita a quota.
- Reel: recusado (`formato_nao_suportado`). A conta por formato é escolhida por `contas.*`, não inferida.
- Hash: o contrato diz "lista ordenada de sha256"; foi implementado como ordem dos slides (ordem importa para o conteúdo). Agência e CRM precisam usar a mesma versão do algoritmo.

## 5. Roteiro de staging (LAVI, 2026-S47, sem publicar)
Pré-requisito: schema da seção 6 aplicado no banco de staging (por revisão do João).
1. No CRM de staging: confirmar usuário da LAVI, gerar a chave de API e anotar o `SocialAccount.id` do Instagram. Não usar o usuário de produção.
2. Na agência: `py scripts/gerar_manifesto.py lavi 2026-S47` (gera `pacote/manifesto.json`; confira as 9 peças).
3. `set CRM_API_KEY=...` (no ambiente, não em arquivo) e `py scripts/enviar_crm.py enviar lavi 2026-S47 --url <staging> --conta-padrao <id>`: simulação. Depois com `--enviar` (modo `validar`): esperado `criado: 9`, nada gravado.
4. Importar: `... --importar --enviar`. Esperado 9 rascunhos; conferir em `/dashboard/redes-sociais/rascunhos` legenda+hashtags, ordem dos slides e conversão PNG para JPEG da URL pública. Nada deve estar em `PENDING`.
5. Repetir o passo 4 (renomear `importacao-crm.json` antes): esperado `inalterado: 9`, sem mídia nova.
6. Alterar uma legenda, `py scripts/gerar_manifesto.py lavi 2026-S47 --atualizar`, reenviar: esperado 1 `atualizado` (versao 2).
7. Reprovação: reenviar uma peça com status diferente de aprovado e conferir que `PATCH publishAt` devolve 409 `editorial_bloqueado`. NÃO agendar peça real: se for preciso testar o agendamento, usar uma conta de teste, nunca a da LAVI.
8. `py scripts/enviar_crm.py estado lavi 2026-S47 --url <staging>`: conferir estados.

## 6. Rollback e pendências de schema
- Pendência de schema: o commit `9ddf389` (`db:`) adiciona a tabela `ExternalPostLink` (colunas `id, userId, source, externalKey, version, contentHash, editorial default "aprovado", postId, plannedAt, meta, createdAt, updatedAt`; únicos/índices `(userId,source,externalKey)`, `postId`, `(userId,source)`). Só aditiva, nenhuma coluna existente muda. Conforme `plano-migracao-rollback.md`, EXIGE revisão do João antes do merge, com backup recente e teste em staging antes. Não foi rodado `db push`.
- Rollback do código: `git revert 781f747` desliga rotas e bloqueio (o PATCH e o agendador voltam ao comportamento anterior). Posts importados continuam como rascunhos normais.
- Rollback do schema: a tabela vazia ou sem uso pode ficar sem prejuízo. Para removê-la, `DROP TABLE ExternalPostLink` manual depois de reverter o código (o `db push` sem `--accept-data-loss` não a removerá sozinho enquanto estiver no schema; ao revertê-lo ela vira divergência do banco, que o `db push` recusará remover com dados; revisar antes). Preferir deixar a tabela e reverter só o código.
- Dados: remover itens importados = apagar os `ScheduledPost` (rascunhos) pelo painel; os vínculos órfãos aparecem como `REMOVIDO` na consulta de estado.

## 7. Ajustes pós-revisão
Revisor independente aprovou com ajustes; cada ponto foi validado no código antes de corrigir.

### Mudanças
1. Revogação editorial (agência): com `--atualizar`, peça do manifesto anterior que deixou de estar aprovada, ou que sumiu do CSV, é emitida com o status real (`reprovado_revisao`, `reprovado`, `removido_do_csv`...), sem mídia, e o CRM a recusa e trava o vínculo. `enviar_crm.py` avisa sobre peças já importadas (`importacao-crm.json`) que não estão mais no manifesto e sobre peças que seguem não aprovadas.
2. Veredito do `revisao.md`: o gerador lê a tabela por slug (aceita `` `pasta/slug` ``, `**APROVADA**`, `APROVADA COM AJUSTE`, `(condicionada)`, `REPROVADA`; testado também contra os `revisao.md` reais de S46, S47 e S48, só leitura). Peça aprovada no CSV mas REPROVADA, sem veredito, ou sem `revisao.md`, nunca sai como aprovada (`reprovado_revisao`, `sem_veredito`, `sem_revisao`).
3. `enviar_crm.py`: recusa manifesto mais antigo que `agendamento.csv`/`revisao.md` ou com mídia cujo sha256 mudou; exige https (http só em localhost/127.0.0.1/::1); não segue redirects; trata resposta sem JSON válido; escapa nome de campo/arquivo no multipart.
4. Mídia compartilhada: a importação guarda em `meta.mediaIds` as mídias que criou; ao trocar de versão só remove essas, e só as que nenhum outro post do usuário referencia. Mídia que o humano pôs no post nunca é apagada.
5. Rota: `content-length` acima de 60 MB devolve 413 antes de `formData()`; lote com mais de 300 arquivos ou 60 MB de mídia devolve 413 (`lote_grande`); teto de 60 peças já existia.
6. Peça apagada pelo humano: o vínculo órfão é apagado e a peça recriada como rascunho, com aviso (antes devolvia "inalterado" para um post inexistente).
7. Menores: `P2002` real tratado (desfaz o post novo, relê o vínculo e devolve `inalterado`; outros erros viram rejeição); aviso "edição manual e agendamento substituídos pela versão N"; o guard do agendador move o post bloqueado para `DRAFT` (não é mais relido a cada ciclo); comentário da rota alinhado (JSON puro só confere contrato/contas/status, peça com mídia sai "arquivo ausente"; para validar de verdade, multipart); avisos para `data_planejada` e `hora_planejada` inválidas; `cliente`/`semana` validados no endpoint de estado (400); vetor de hash com emoji, aspas, `\n`, U+2028 e barra invertida nos testes TS e Python (mesmo hash `2111bcc1...de36`); testes de `draft:true` e `applyToGroup` com peça bloqueada.

### Resultados reais
- `npm run typecheck`: sem erros.
- `npm test` (suíte completa, sozinha): 129 arquivos, 2189 testes, todos passaram. Uma primeira execução concorrente com eslint teve 7 timeouts de ~16 s em testes não relacionados; esses arquivos passaram isolados e a suíte completa passou na repetição sem carga paralela.
- `importar-pacote.test.ts`: 33 testes passam (13 novos ou ajustados).
- eslint nos 4 arquivos alterados: sem problemas.
- `npm run build` (env fictício só no processo): concluído com sucesso.
- `py -I -B scripts/test_gerar_manifesto.py` (agência): 17 testes, OK. O comando `py -I -m unittest scripts/test_gerar_manifesto.py` não encontra o módulo porque `-I` tira o diretório atual do caminho; o arquivo roda direto ou com `-m unittest discover -s scripts`.

### Não verificado
- Nada rodou contra banco real, rede ou Meta; o banco é em memória nos testes. `P2002` foi simulado com erro de código `P2002`, não com Prisma real.
- A varredura de referências a mídia usa todos os posts do usuário (sem índice por mídia); aceitável no volume atual, a revisar se um usuário tiver milhares de posts.
- Posts importados antes desta mudança não têm `meta.mediaIds`: na próxima versão suas mídias antigas não são removidas (ficam órfãs, sem risco). Nenhuma importação real existe ainda.
- `--importar` real e o roteiro de staging da seção 5 continuam pendentes. Os scripts da agência seguem não commitados.

## Correções da revisão Codex

Três achados de uma revisão independente, confirmados no código e corrigidos em commits separados (`src/modules/social/importar-pacote.ts`, sem mudança de schema).

7. **Atomicidade**: a atualização do post e a do `ExternalPostLink` eram gravações separadas; se a segunda falhasse, o post ficava alterado e a resposta dizia "rejeitado". Agora as duas ocorrem na mesma `$transaction`; em rollback as mídias novas são removidas, e as antigas só saem depois do commit.
8. **Concorrência entre versões**: a atualização do vínculo é condicional (`where` com versão, hash e estado editorial lidos) dentro da transação; se outra importação mudou a peça, há rollback e a peça é rejeitada como `versao_antiga`. Após `P2002` na criação, só é `inalterado` se o vencedor tem a mesma versão e o mesmo hash; vencedor mais novo rejeita, vencedor mais antigo reprocessa pela rota de atualização.
9. **Decisões versionadas**: a versão da revogação fica em `meta.revogadoNaVersao` (sem coluna nova). Reaprovar (inclusive o mesmo hash) exige versão posterior a ela; decisão de versão mais antiga que a registrada é ignorada e não derruba uma versão mais nova aprovada.

Testes: 5 de regressão novos em `importar-pacote.test.ts` (cada um falha sem a correção e passa com ela); o banco em memória ganhou `$transaction` com rollback e leituras que devolvem cópias, como o Prisma real. Não verificado: nada rodou contra Postgres real, então o isolamento real das transações e o `updateMany` condicional concorrente só foram simulados.

### Segunda rodada da revisão

Três ajustes adicionais, cada um em commit próprio, com teste de regressão que falhava antes da correção.

10. **Revogação condicional e atômica**: `revogar` gravava o vínculo sem condição, a partir de uma leitura antiga, e podia sobrescrever `meta.mediaIds` de uma importação concorrente (mídias novas órfãs, antigas apagadas). Agora usa `updateMany` com id, versão, hash e estado editorial lidos; se não casar, relê uma vez, ignora se já há revogação em versão igual ou maior e, senão, tenta de novo (persistindo o conflito, rejeita como `versao_antiga`). O vínculo e a volta do agendado a rascunho ficam na mesma `$transaction`.
11. **Criação atômica**: `scheduledPost.create` e `externalPostLink.create` agora estão na mesma `$transaction`; uma queda entre os dois não deixa post DRAFT órfão. A compensação por `deleteMany` foi removida; as mídias já gravadas continuam sendo removidas no catch.
12. **Limpeza não esconde o erro**: o `mediaStorage.remove` nos `catch` (atualização, criação e envio de mídias) engole a própria falha (`.catch(() => {})`), preservando o `ErroItem` original.

Testes novos: 5 (3 na revogação, 1 na criação, 1 na limpeza); o banco em memória passou a manter linhas gravadas por outra conexão após um rollback. Não verificado: continua sem Postgres real, então o comportamento das transações interativas do Prisma sob concorrência verdadeira é só simulado.
