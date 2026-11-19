# Automações por Instagram e Messenger

Os fluxos de automação respondem por Instagram DM, Messenger DM e resposta privada a comentário. O envio mora em `src/modules/automacoes/canais/meta-social.ts` e usa o token da Página guardado (criptografado) em `SocialAccount`. Tudo continua desligado por padrão.

## O que o fluxo faz em canal social

- Nó `texto`: envia pelo canal de origem do gatilho. Instagram aceita até 1000 bytes, Messenger até 2000 caracteres.
- Nó `template`: só existe no WhatsApp. Em canal social a execução falha com o erro "template é só WhatsApp".
- Nós `espera`, `condicao`, `variavel`, `etiqueta` e `transferencia_humana` funcionam como antes.
- Janela: DM só dentro de 24 horas da última mensagem da pessoa. Fora dela a execução falha como política e nada é enviado (o `human_agent` de 7 dias não é usado). Resposta privada vale até 7 dias após o comentário e a Meta aceita uma única por comentário; um segundo nó de texto no mesmo fluxo de comentário falha, e a conversa só continua depois que a pessoa responder.
- "SAIR" ou "PARAR" na DM grava opt-out e cancela execuções em andamento antes do próximo envio.
- Falhas: 4xx da Meta é permanente; 5xx sem código é transitório (nova tentativa com espera); limite de taxa é transitório; erro de rede ou resposta sem id vira "resultado desconhecido" e nunca é reenviado. As mensagens gravadas não contêm token nem o corpo bruto da Meta.

## Como ligar

1. No app da Meta, adicione os produtos Messenger e Instagram e as permissões: `instagram_manage_messages`, `instagram_manage_comments`, `pages_messaging`, `pages_read_user_content`, `pages_manage_metadata`. Fora do modo de desenvolvimento elas exigem revisão do app (acesso avançado).
2. Login: sem `SOCIAL_META_CONFIG_ID` o CRM já pede essas permissões (`SCOPES` em `src/modules/social/oauth.ts`). Com `SOCIAL_META_CONFIG_ID` (Login para Empresas) as permissões vêm da configuração criada no painel da Meta, então inclua as mesmas lá. Depois de mudar as permissões, reconecte as contas no CRM.
3. Webhook: URL `https://<seu-dominio>/api/social/webhook`. No objeto Instagram assine `messages` e `comments`; no objeto Page assine `messages` e `feed`. A Página precisa estar inscrita no app para receber os eventos.
4. Variáveis: `SOCIAL_WEBHOOK_VERIFY_TOKEN` (o mesmo valor digitado como token de verificação na Meta) e `SOCIAL_META_APP_SECRET` (valida a assinatura HMAC dos eventos). `SOCIAL_TOKEN_KEY` ou `AUTH_SECRET` protege os tokens guardados.
5. Flags (só o valor `true` liga): `AUTOMACOES_ATIVAS` (worker), `AUTOMACOES_GATILHO_IG_DM`, `AUTOMACOES_GATILHO_IG_COMENTARIO`, `AUTOMACOES_GATILHO_MSGR_DM`, `AUTOMACOES_GATILHO_MSGR_COMENTARIO`.
6. Confira em `GET /api/automacoes/gatilhos/diagnostico`: cada gatilho mostra `desabilitado_flag`, `bloqueado_permissao`, `webhook_nao_configurado` ou `habilitado`.

## Testar com conta própria (acesso padrão)

Em modo de acesso padrão, o app só enxerga quem tem função nele (administrador, desenvolvedor ou testador). Então:

1. Dê a você mesmo (e à conta que vai escrever) uma função no app e use uma conta Instagram profissional ligada a uma Página sua.
2. Conecte a conta no CRM, crie um fluxo com gatilho "qualquer DM" e um nó de texto, publique e ligue só `AUTOMACOES_GATILHO_IG_DM` e `AUTOMACOES_ATIVAS` no ambiente de teste.
3. De outra conta com função no app, envie uma DM para a conta profissional. A resposta deve chegar em segundos.
4. Repita para comentário (resposta privada) e Messenger. Em produção não ligue nada antes de testar no staging.

## Pontos a confirmar na primeira execução real

O envio de Instagram usa `POST /{page-id}/messages` com o token da Página (caminho do Login do Facebook). Se a Meta responder com erro de endpoint para a conta Instagram, o caminho alternativo é `graph.instagram.com/{ig-id}/messages` com token do Login do Instagram, que exigiria outro fluxo de conexão. Documentação consultada: Messenger Platform (Send API, Private Replies, políticas de janela) e Instagram Platform (Messaging API, Private Replies, Human Agent) em developers.facebook.com.
