# Guia de uso — Disparador LAVI

Endereço local: http://localhost:3000 · Login em `/auth/login`.

## 0. Antes de tudo
1. **Selecione a sessão** no seletor no topo da tela (ex.: "WPP LAVI"). Quase todas as telas trabalham sobre a sessão selecionada.
2. A sessão precisa estar **CONNECTED** (verde). Se não estiver, vá em *Sessões / QR*.

## 1. Sessões / QR — conectar o WhatsApp
1. *Sessões / QR* → **Criar sessão** (nome, ex.: "WhatsApp do salão").
2. Clique em **Gerenciar** → **Iniciar sessão**.
3. No celular: WhatsApp → Aparelhos conectados → Conectar aparelho → escaneie o QR (ou use "vincular com número de telefone" e digite o código).
4. Status vira CONNECTED. **Reiniciar / Parar / Desconectar / Excluir** ficam na mesma tela.
5. **Compartilhar**: dá acesso da sessão a outro usuário pelo e-mail.

## 2. Conversas
Atende pelo painel como no WhatsApp Web: lista de conversas à esquerda, mensagens à direita. Dá para responder, anexar arquivos, atribuir etiquetas e abrir conversa com qualquer número ("Número de telefone" → Ir).

## 3. Disparo (envio em massa)
1. *Disparo* → aba **Novo disparo**.
2. Em **Destinatários**, cole os números com DDI+DDD+número, **um por linha** ou separados por vírgula. Ex.: `5561999999999`.
3. Escreva a **Mensagem** (aceita *negrito*, _itálico_).
4. Ajuste o **Intervalo** entre mensagens (use 5 s ou mais; o sistema ainda soma um tempo aleatório).
5. **Iniciar disparo**. Acompanhe enviadas / falhas / pendentes. A aba **Histórico** guarda tudo.
- Dica anti-banimento: não dispare para quem não conhece o salão, comece com poucos números e aumente aos poucos. Ative a proteção em *Configurações do Bot → Proteção anti-banimento*.

## 4. Agendador
Programa mensagens: **Único** (data e hora) ou **Recorrente** (a cada X min/horas, dias da semana, cron). *Agendar nova mensagem* → JID do destinatário (`5561999999999@s.whatsapp.net` para pessoa, ID do grupo para grupos) → mensagem → salvar. Acompanha em *Fila pendente* e *Histórico*.

## 5. Resposta automática
*Resposta automática* → **Nova regra**: palavra-chave (ex.: `preço`), tipo de correspondência (exata, contém, começa com, regex), público (todos, só privado, só grupos), resposta (texto e/ou mídia). Quando o cliente escrever a palavra, o app responde sozinho.

## 6. Contatos e Grupos
- **Contatos**: lista dos contatos sincronizados da sessão, com busca.
- **Grupos**: lista, busca e criação de grupos.

## 7. Etiquetas
Etiquetas coloridas para organizar conversas: *Nova etiqueta* → nome e cor → **Atribuir** conversas. O painel tenta importar as etiquetas do WhatsApp Business ao conectar; as criadas aqui valem só no painel.

## 8. Configurações do Bot
Prefixo de comandos, modo (público/privado/lista), mensagem de boas-vindas, "sempre online", leitura automática, conversão de imagens em figurinhas, **proteção anti-banimento** e privacidade (modo fantasma, anti-exclusão). Cada bloco tem seu botão de salvar.

## 9. Criador de figurinhas e Mídia
- **Criador de figurinhas**: envie uma imagem, defina nome do pacote/autor e mande para um número.
- **Gerenciador de mídia**: arquivos baixados pelo sistema; selecione e exclua para liberar espaço.

## 10. Perfil do bot
Altera nome, recado e foto do WhatsApp conectado.

## 11. Webhooks e API (integrações, ex.: n8n)
- Gere a **Chave de API** e use no cabeçalho `X-API-Key`.
- **Webhooks**: cadastre uma URL e escolha os eventos (mensagem recebida, enviada, conexão…) para o sistema avisar outras ferramentas.
- A documentação completa dos endpoints está em *Documentação da API*.

## 12. Administração (só Super Admin)
**Usuários** (criar contas e funções), **Notificações** (avisos aos usuários), **Monitor do sistema** (CPU, memória, disco) e **Configurações** (nome do app, fuso, cadastro público).

## Fluxo sugerido para o salão
1. Conectar o número (Sessões / QR).
2. Criar etiquetas (Cliente VIP, Retorno, Novo lead).
3. Configurar 3–5 respostas automáticas (preço, endereço, horário, agendamento).
4. Montar a lista de números e fazer um disparo de teste com 2–3 pessoas.
5. Agendar lembretes de retorno.
