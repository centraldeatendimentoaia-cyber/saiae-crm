# Deploy no Railway — Saiaê

O app é um servidor Node que fica ligado (mantém o WhatsApp conectado), por isso roda em container no Railway e **não** na Vercel.

Arquitetura final (3 serviços no mesmo projeto Railway):

| Serviço | O que é | Observação |
|---|---|---|
| **app** | este repositório, via `Dockerfile` | porta 3000, domínio público |
| **MySQL** | banco do Railway (template MySQL) | guarda contatos, mensagens **e a sessão do WhatsApp** |
| **backup** | o mesmo repositório com outro comando | roda 1 vez por dia e envia o dump para fora |

## 1. Repositório
O Railway faz o deploy a partir do GitHub. Crie um repositório **privado** seu e envie este projeto para ele (o `origin` atual ainda aponta para o projeto original).

## 2. Projeto e banco
1. railway.com → **New Project** → **Deploy MySQL**.
2. No mesmo projeto: **+ New** → **GitHub Repo** → escolha o repositório. O Railway detecta o `railway.json` e usa o `Dockerfile`.

## 3. Variáveis do serviço **app**
Em *Variables*, crie:

| Variável | Valor |
|---|---|
| `DATABASE_URL` | `${{MySQL.MYSQL_URL}}` (referência ao serviço MySQL) |
| `AUTH_SECRET` | gere com `openssl rand -base64 32` |
| `AUTH_TRUST_HOST` | `true` |
| `BASE_URL` | `https://SEU-DOMINIO` |
| `NEXTAUTH_URL` | `https://SEU-DOMINIO` |
| `NEXT_PUBLIC_APP_URL` | `https://SEU-DOMINIO` |
| `NEXT_PUBLIC_API_URL` | `https://SEU-DOMINIO/api` |
| `ADMIN_EMAIL` | e-mail do administrador |
| `ADMIN_PASSWORD` | senha forte do administrador |
| `GEMINI_API_KEY` | sua chave (https://aistudio.google.com/apikey) |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` |
| `TZ` | `America/Sao_Paulo` |
| `BAILEYS_LOG_LEVEL` | `error` |
| `NODE_ENV` | `production` |
| `PORT` | `3000` (precisa bater com a porta configurada no domínio) |

Observações:
- `NEXT_PUBLIC_*` são gravadas **na hora do build**: defina antes do primeiro deploy (ou refaça o deploy depois de mudar).
- Não defina `NEXT_PUBLIC_SWAGGER_PASSWORD` se não quiser expor a documentação interativa (`/swagger`). Sem a senha, ninguém entra.
- `PORT` deve ser `3000`, a mesma porta configurada em Networking (domínio). Se forem diferentes, o site responde 502.

## 4. Volume (arquivos de mídia)
Serviço **app** → *Settings* → **Volumes** → adicionar volume montado em **`/app/data`**.
Sem isso, as mídias baixadas somem a cada deploy. (A sessão do WhatsApp fica no MySQL, então não depende do volume.)

## 5. Domínio
Serviço **app** → *Settings* → **Networking** → **Generate Domain** (ou use domínio próprio). Depois atualize `BASE_URL`, `NEXTAUTH_URL`, `NEXT_PUBLIC_APP_URL` e `NEXT_PUBLIC_API_URL` com o endereço final e faça um novo deploy.

## 6. Primeiro acesso
1. Abra `https://SEU-DOMINIO/auth/login` e entre com `ADMIN_EMAIL` / `ADMIN_PASSWORD` (a conta é criada como Super Admin no primeiro start).
2. **Sessões / QR** → criar sessão → iniciar → escanear o QR. A sessão do WhatsApp do seu PC **não migra**: é preciso parear de novo no servidor.
3. **Configurações** → desligue **Permitir cadastro de usuários** (senão qualquer pessoa pode criar conta).
4. Crie a conta da sua mãe em **Usuários** e conecte o número do salão em uma sessão dela.

## 7. Backup diário (serviço **backup**)
1. No projeto: **+ New** → **GitHub Repo** → o mesmo repositório.
2. *Settings*:
   - **Custom Start Command**: `node scripts/backup-db.js`
   - **Cron Schedule**: `0 6 * * *` (03:00 em Brasília; o Railway usa UTC)
3. *Variables*:
   - `DATABASE_URL` = `${{MySQL.MYSQL_URL}}`
   - `BACKUP_S3_BUCKET`, `BACKUP_S3_ENDPOINT`, `BACKUP_S3_KEY_ID`, `BACKUP_S3_SECRET` (bucket S3-compatível, por exemplo Backblaze B2 ou Cloudflare R2, que têm plano gratuito pequeno)
   - `BACKUP_S3_REGION` (se o provedor exigir)
4. Rode uma vez manualmente (*Deploy → Run*) e confira se o arquivo `.sql.gz` apareceu no bucket.

> O arquivo gerado dentro do próprio container some quando ele termina. Por isso o envio ao bucket é o que de fato protege os dados.

### Restaurar um backup
```bash
gunzip -c wa_akg-AAAA-MM-DDTHH-MM-SS.sql.gz | mysql -h HOST -P PORTA -u USUARIO -p BANCO
```

## 8. WhatsApp em servidor: cuidados
- Um número só pode estar ativo em um lugar por sessão. Antes de parear no Railway, **desconecte** a sessão do seu PC (ou pare o servidor local).
- Mantenha o intervalo de disparo em 5 segundos ou mais e ative a proteção anti-banimento em *Configurações do Bot*.
- Se o servidor reiniciar, a sessão reconecta sozinha (as credenciais estão no MySQL).

## Custos estimados
Railway cobra por uso: app + MySQL costumam ficar entre **US$ 5 e 15 por mês** para este tamanho. O plano Hobby não tem backup automático do banco — por isso o item 7.
