# Incidente de credenciais: auditoria Sprint 0

Data da auditoria: 2026-11-13
Escopo: `D:\Projetos\_saiae\saiae-crm` (todas as 138 refs de branches/tags e 602 commits) e `D:\agencia-marketing` (9 commits, sem remote).
Modo: somente leitura. Nenhum valor de segredo foi copiado para este documento. Nenhuma credencial foi rotacionada, nenhum serviço externo (Railway, Meta, produção) foi tocado.

Observação de método: a única consulta externa foi um `gh repo view` de metadados (somente leitura) para saber a visibilidade do remote do CRM. Os arquivos `.env*` locais não rastreados (por exemplo `.env.avaliacao`) não foram lidos, por regra de proteção; só foi verificado que existem e que não estão versionados.

## 1. Resumo executivo

- Não foi encontrado nenhum segredo real versionado, nem no estado atual nem no histórico git, nos padrões pesquisados (Meta `EAA...`, `sk-`/`sk-ant-`, `ghp_`/`gho_`/etc., `AKIA...`, `AIza...`, `xox*`, JWT `eyJ...`, URLs `mysql://`/`postgres://` com senha). O alerta anterior não se confirma como vazamento de segredo de produção no repositório.
- O remote do CRM (`centraldeatendimentoaia-cyber/saiae-crm`) é PÚBLICO. Por isso qualquer valor commitado, mesmo "de teste" ou default, é considerado exposto. Este é o fator que eleva a severidade dos achados abaixo.
- Existem valores fracos/padrão e exemplos versionados (senha de Swagger exposta no bundle do navegador, API key de teste hardcoded, CORS aberto no Socket.IO). Não são credenciais de produção conhecidas, mas precisam de correção.
- `D:\agencia-marketing` não tem remote, não versiona `.env`/tokens e não contém padrões de segredo. Risco baixo; o ponto de atenção é o backup/sincronização local da pasta.
- Limitação: ausência de achado em regex não prova ausência de segredo. Segredos sem formato reconhecível (por exemplo `AUTH_SECRET`, `WHATSAPP_APP_SECRET`, `COMANDA_WEBHOOK_SECRETS`, que são strings aleatórias) só seriam pegos por atribuição direta, e nenhuma foi encontrada. Recomenda-se rodar também uma ferramenta dedicada (gitleaks ou trufflehog) localmente antes de dar o caso por encerrado.

## 2. Resultados da busca

### 2.1 saiae-crm

| Verificação | Resultado |
|---|---|
| Arquivos `.env*` rastreados | Apenas `.env.example` (esperado). Nenhum `.env` jamais adicionado em qualquer commit do histórico (verificado por nome de arquivo adicionado). |
| `.gitignore` cobre `.env` | Sim: regra `.env*` com exceção `!.env.example` (linhas 34 e 35). Cobre também `.env.avaliacao`, que existe localmente e não está rastreado. `/backups` também ignorado. |
| Arquivos sensíveis no histórico (`.pem`, `.key`, `.sql`, `.dump`, `.bak`, `auth_info`, `creds.json`) | Nenhum. |
| `railway.backup.json` | Sem segredo (só builder, comando `node scripts/backup-db.js` e cron `0 6 * * *`). |
| `Dockerfile.backup` | Sem segredo. |
| `ecosystem.config.js` | Sem valores literais de segredo (apenas blocos `env`). |
| `start.sh` | Sem segredo; lê `AUTH_SECRET`, `ADMIN_PASSWORD`, etc. do `.env` e avisa se estiverem nos valores padrão. |
| `docker-compose.yml` | Usa referências `${VAR}` para `MYSQL_ROOT_PASSWORD`, `AUTH_SECRET`, `ADMIN_PASSWORD`, `NEXT_PUBLIC_SWAGGER_PASSWORD`. A `DATABASE_URL` monta a URL do MySQL com `root` e a variável de senha. Sem valor literal. |
| `patches/` | Só o patch do Baileys. Sem segredos. |
| `data/` | Só `data/media/.gitkeep`. |
| Padrões de token no histórico (`git log -G`, todas as refs) | 0 commits com padrões Meta/OpenAI-Anthropic/GitHub/AWS/Google/Slack/JWT. |
| URLs de banco com senha | 10 ocorrências, todas exemplos/placeholders em `.env.example`, `docs/DATABASE_SETUP.md`, `docs/ENVIRONMENT_VARIABLES.md`, `scripts/backup-db.js` (comentário), `.github/workflows/ci.yml` (banco efêmero de CI) e `docker-compose.yml` (com variável). Nenhuma aponta para host real. |
| Segredos em `src/` com fallback literal (`|| "..."`) | Não encontrados. |

`src/modules/integracao/comanda/secrets.ts` está correto no desenho: segredos por barraca só por variável de ambiente, com suporte a rotação (lista com novo e antigo) e resposta 503 quando não configurado.

### 2.2 agencia-marketing

- Sem remote configurado (repositório só local, 9 commits, 757 arquivos rastreados).
- Nenhum `.env`, token, credencial ou arquivo `*secret*` rastreado. `.gitignore` cobre `.env`, `.claude/`, `aprovacoes/logs/` e `.bin/`.
- Nenhum padrão de segredo no worktree nem nos commits recentes. Os scripts não leem variáveis de segredo por `os.environ`/`process.env`.
- Menções a "META"/"access_token"/"WHATSAPP" encontradas em arquivos de prompt/documentação, relatórios, HTML de aprovação e CSV de métricas, sem valores.
- Pendência de higiene: há arquivos modificados e não commitados (`CLAUDE.md`, `aprovacoes/*`, layouts de arte). Antes de qualquer commit futuro, passar scanner de segredos.

## 3. Inventário de credenciais potencialmente afetadas

Legenda de exposição: "público" = repositório com remote público (saiae-crm); "local" = apenas na máquina.

| # | Nome | Tipo / serviço | Onde aparece (sem valor) | Repo | Severidade |
|---|---|---|---|---|---|
| 1 | `NEXT_PUBLIC_SWAGGER_PASSWORD` | Senha da página `/swagger` | `.env.example` (valor padrão fraco, linha 83); `docker-compose.yml:41`; checada no cliente em `src/app/swagger/page.tsx:43`. O prefixo `NEXT_PUBLIC_` embute o valor no bundle JavaScript enviado ao navegador. | público | Alta: qualquer visitante lê a senha no bundle, e o padrão do exemplo é adivinhável. |
| 2 | API key de teste `wag_...` | Chave de API do gateway WhatsApp (usuário de teste) | `scripts/setup-test-user.ts:7`, `scripts/test_endpoints.sh:3`, em 4 commits do histórico (a partir de 3d4ffe3, 2026-10-05). `setup-test-user.ts:22` ainda imprime a chave no console. | público | Média: parece valor de teste, mas confirmar que a chave não existe em staging/produção. Se existir, tratar como comprometida. |
| 3 | `AUTH_SECRET` | Segredo de sessão NextAuth/JWT | `.env.example:25` (placeholder fraco "change this"); `docker-compose.yml`; `start.sh` valida o padrão. | público (apenas placeholder) | Média: risco só se produção usar o placeholder. Validar. |
| 4 | `ADMIN_PASSWORD`, `MYSQL_ROOT_PASSWORD` | Senha do superadmin e do MySQL | `.env.example` (placeholder "change-this-in-production"), `docker-compose.yml`, `start.sh`. | público (apenas placeholder) | Média: mesmo caso do item 3. |
| 5 | `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `META_WA_ACCESS_TOKEN` | Meta app secret, verify token do webhook e token de acesso WhatsApp Cloud | Somente como nomes vazios em `.env.example` (linhas 149, 150, 156). Nenhum valor no repositório. | público | Baixa (sem exposição encontrada). Rotação só por precaução (seção 4). |
| 6 | Tokens de login Meta (Instagram/Facebook, tokens de página) | OAuth Meta do módulo social | Commits `98f082a` e `6bb46c1` mexem no fluxo, sem token no diff. Tokens ficam no banco. | público (código) | Baixa no repositório; verificar armazenamento no banco (ver seção 5). |
| 7 | `COMANDA_WEBHOOK_SECRETS`, `COMANDA_CODIGO_SECRET` | Segredos HMAC por barraca e de código de comanda | Somente nomes vazios em `.env.example`. | público | Baixa. |
| 8 | `GEMINI_API_KEY`, `RESEND_API_KEY`, `STRIPE_WEBHOOK_SECRET`, `REMOVE_BG_API_KEY` | IA, e-mail, Stripe, remoção de fundo | Somente nomes vazios em `.env.example`. | público | Baixa. |
| 9 | `DATABASE_URL` (Railway: Postgres/MySQL de staging e produção) | Banco de dados | Só exemplos/placeholders no repositório. Valores reais residem no Railway e em `.env` locais. | público (placeholders) | Baixa no repositório. |
| 10 | Arquivos `.env*` locais (por exemplo `.env.avaliacao`) | Variáveis locais | Não rastreados nem no histórico. Existem na máquina; conteúdo não auditado. | local | A confirmar: conteúdo pode ter valores reais; ver pendência na seção 7. |
| 11 | Chaves de agencia-marketing (Meta/Instagram dos clientes) | Tokens de clientes | Nenhum valor encontrado; scripts não leem segredos por variável de ambiente. | sem remote | Baixa. |

Não há evidência de: S3/AWS, Anthropic, GitHub token ou NEXTAUTH_SECRET reais versionados.

## 4. Plano de rotação controlada (execução depende de autorização separada)

Princípio: como não há segredo real comprovadamente exposto, rotacionar por prioridade de risco e por higiene. Ordem sugerida, uma credencial por vez, fora do horário de pico, com janela combinada com o João.

Pré-requisitos comuns: inventário das variáveis reais no Railway (staging primeiro, produção depois); backup do banco e exportação das variáveis atuais para cofre pessoal antes de qualquer mudança; registrar hora de início e fim.

### Etapa 0. Verificações sem alteração
1. Conferir no Railway (produção e staging) se `AUTH_SECRET`, `ADMIN_PASSWORD`, `MYSQL_ROOT_PASSWORD` e `NEXT_PUBLIC_SWAGGER_PASSWORD` NÃO estão iguais aos placeholders do `.env.example` (comparar sem exibir: apenas "é igual / é diferente").
2. Conferir se a API key `wag_...` de teste existe como usuário no banco de staging ou produção.
3. Rodar gitleaks/trufflehog localmente (cópia clonada) em saiae-crm e agencia-marketing para confirmar a conclusão desta auditoria.

### Etapa 1. Senha do Swagger (item 1)
- Correção estrutural (código, autorização separada): remover `NEXT_PUBLIC_` e validar a senha no servidor ou proteger `/swagger` pela sessão de admin. Rotação da senha por si só não resolve, pois o valor continua no bundle.
- Onde: variável no Railway e rebuild (a variável `NEXT_PUBLIC_*` é gravada no build).
- Impacto: baixo; só quem usa `/swagger`. Sem downtime além do deploy.
- Validar: abrir o bundle em produção e confirmar que a senha não aparece; testar acesso ao `/swagger`.
- Rollback: restaurar a variável anterior e redeploy.

### Etapa 2. API key de teste `wag_...` (item 2)
- Se existir no banco: revogar/excluir o usuário de teste ou gerar nova chave e remover a antiga.
- Código: ler a chave de variável de ambiente; não imprimir a chave no log (`setup-test-user.ts:22`).
- Impacto: nenhum para clientes reais. Validar: chamada com a chave antiga retorna 401.
- Rollback: recriar usuário de teste em staging.

### Etapa 3. Segredos de aplicação (itens 3 e 4), se a Etapa 0 mostrar valor padrão
- `AUTH_SECRET`: gerar valor aleatório novo (32 bytes ou mais) e trocar no Railway. Impacto: todas as sessões ativas caem; usuários precisam logar de novo. Janela curta de baixa atividade. Validar: login novo funciona e rota protegida responde. Rollback: restaurar valor anterior (sessões voltam a valer).
- `ADMIN_PASSWORD`: trocar pelo fluxo da própria aplicação (script `make-admin`/painel) e atualizar a variável. Validar: login do superadmin.
- `MYSQL_ROOT_PASSWORD`: só relevante se usar o MySQL do docker-compose; no Railway a senha do banco é gerenciada pelo serviço. Trocar exige atualizar `DATABASE_URL` em todos os serviços (app, WhatsApp, backup cron) ao mesmo tempo. Backup obrigatório antes. Rollback: restaurar a senha e a URL anteriores.

### Etapa 4. Credenciais Meta e WhatsApp (item 5 e 6), rotação preventiva
Executar somente com autorização explícita e coordenação, pois afeta mensagens em produção.
1. `WHATSAPP_VERIFY_TOKEN`: gerar novo, atualizar no Railway e no painel do app Meta (configuração do webhook) na mesma janela. Impacto: webhook falha entre as duas trocas (segundos a minutos); mensagens ficam em retry da Meta. Validar: botão "Verificar e salvar" da Meta e mensagem de teste. Rollback: voltar o token antigo nos dois lados.
2. `WHATSAPP_APP_SECRET` (segredo do app Meta, redefinir no painel do app): atualizar no Railway imediatamente após a redefinição. Impacto: assinaturas HMAC de webhook são rejeitadas até a atualização. Validar: enviar mensagem de teste e conferir a validação da assinatura. Rollback: não há como restaurar o segredo antigo na Meta; por isso fazer em janela com acesso ao Railway aberto.
3. `META_WA_ACCESS_TOKEN`: gerar novo token de usuário do sistema (System User) com as mesmas permissões, trocar no Railway e então revogar o antigo. Impacto: envio falha se o novo não for aplicado antes de revogar o antigo; manter o antigo ativo até validar. Validar: envio de mensagem de teste. Rollback: reativar o antigo antes de revogá-lo (por isso a ordem).
4. Tokens de página/Instagram do módulo social: não rotacionar em massa. Se houver suspeita, revogar o app nas configurações de cada página e reconectar pelo fluxo de login; impacto: o cliente precisa reautorizar.

### Etapa 5. Demais chaves de serviços (item 7 e 8)
`COMANDA_WEBHOOK_SECRETS` (usar o suporte nativo a lista com novo e antigo e remover o antigo depois), `STRIPE_WEBHOOK_SECRET` (rolar o segredo do endpoint no painel Stripe, que permite período de sobreposição), `RESEND_API_KEY`, `GEMINI_API_KEY`, `REMOVE_BG_API_KEY` (criar chave nova, aplicar no Railway, validar uma chamada e revogar a antiga). Impacto baixo, sem downtime quando se mantém a chave antiga viva até validar.

### Etapa 6. Após cada rotação
Atualizar o cofre de senhas, registrar data e quem executou, e garantir que o valor antigo foi revogado no serviço de origem.

## 5. Checklist de limpeza de histórico (decisão, não executar)

Como não foram achados segredos reais no histórico, a reescrita do histórico em si NÃO é recomendada neste momento. Ela só deve ser considerada se a Etapa 0 confirmar que a API key de teste ou algum valor real foi commitado. Pontos de decisão:

1. Confirmar com scanner dedicado se existe algum segredo real no histórico. Se não, encerrar sem reescrever.
2. Se existir: primeiro rotacionar/revogar. Reescrever histórico não torna um segredo seguro, porque o repositório é público e pode ter sido clonado ou indexado.
3. Se a decisão for reescrever: listar commits e arquivos afetados (hoje: `scripts/setup-test-user.ts` e `scripts/test_endpoints.sh` nos 4 commits com a chave de teste); usar `git filter-repo` em um clone espelho; avisar todos os colaboradores para reclonar.
4. Impactos a avaliar: reescrita muda todos os hashes; pull requests abertos e os 138 refs precisam ser recriados; ambientes Railway ligados à branch precisam ser reapontados; o GitHub mantém caches de commits antigos (pedir ao suporte a limpeza de caches, e desativar forks se houver).
5. Alternativa de menor custo: tornar o repositório privado, se a política do projeto permitir, e manter o histórico. Decidir se o código precisa mesmo ser público.
6. Depois: ativar secret scanning e push protection do GitHub e adicionar gitleaks ao hook de pré-commit.

## 6. Outros riscos de configuração

| Risco | Onde | Severidade | Recomendação |
|---|---|---|---|
| CORS aberto (`origin: "*"`) no Socket.IO | `src/server/index.ts:43` | Média | Restringir à origem do app e exigir autenticação no handshake. |
| Senha de página protegida no cliente | `src/app/swagger/page.tsx:43` | Alta | Ver Etapa 1. |
| `trustHost: true` no NextAuth | `src/auth.config.ts:39` | Baixa a média | Aceitável atrás do proxy do Railway, mas fixar `AUTH_URL`/hosts permitidos. |
| Flags de cookie (`secure`, `sameSite`, `httpOnly`) não definidas explicitamente | `src/` (nenhuma ocorrência) | Baixa | Depende dos defaults do NextAuth em produção sobre HTTPS; confirmar no navegador que o cookie de sessão sai `Secure; HttpOnly; SameSite=Lax`. |
| Log imprime API key | `scripts/setup-test-user.ts:22` | Média | Não imprimir a chave; mostrar só os 4 primeiros caracteres ou gravar em arquivo ignorado. |
| Token de reset de senha em query string e em link de e-mail | `src/app/api/auth/forgot-password/route.ts:41` e `src/lib/stripe-billing.ts:130` | Baixa | Prática comum; garantir expiração curta, uso único e `Referrer-Policy: no-referrer` na página de reset. |
| Logs com tokens | Busca em `console.*` só achou mensagens genéricas de erro (sem valor de segredo), exceto o item da API key. Não foram auditados logs de produção. | Baixa | Revisar logs do Railway por `Authorization`, `access_token` e `token=` em URLs. |
| Senhas padrão nos exemplos ("change-this-in-production", valor fraco do Swagger) | `.env.example` | Média | Deixar os campos vazios e fazer o app/`start.sh` recusar iniciar em produção com valores vazios ou padrão. |
| Segredos de CI e banco de CI com usuário/senha simples | `.github/workflows/ci.yml:22` | Baixa | Aceitável (banco efêmero); não reutilizar em outros ambientes. |
| Produção sem backup (pendência já registrada na memória do projeto) | Railway | Alta (operacional) | Fora do escopo deste incidente, mas é pré-requisito para qualquer rotação de senha de banco. |
| Pasta `agencia-marketing` sem remote nem backup | Local | Baixa | Definir backup; manter `.gitignore` e scanner antes de qualquer push. |

## 7. Pendências e próximos passos

1. Autorização do João para executar a Etapa 0 (somente verificação) no Railway.
2. Rodar gitleaks/trufflehog nos dois repositórios e anexar o resultado (contagem, sem valores).
3. Revisar o conteúdo dos `.env*` locais (por exemplo `.env.avaliacao`) pelo dono, confirmando se contêm valores reais e se algum já foi enviado a terceiros ou ferramentas.
4. Decidir: manter repositório público ou torná-lo privado; reescrever histórico (seção 5) ou não.
5. Abrir tarefas de código: remover `NEXT_PUBLIC_` do Swagger, restringir CORS do Socket.IO, parar de imprimir a API key, remover a chave de teste dos scripts, endurecer defaults do `.env.example`.
