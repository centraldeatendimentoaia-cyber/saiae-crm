# Cadastro de um cliente para disparos pela API oficial (passo a passo)

Rascunho operacional. As regras da Meta mudam: confirme os pontos marcados com (Meta) na documentação
oficial antes de fechar com um cliente. Este documento não altera o canal de teste do Saiaê app.

## Regra de ouro: número novo, só para disparos

**Recomendação padrão:** cada cliente ganha um **número novo, dedicado aos disparos**. O número principal
dele continua no celular, como hoje.

Por quê:
- Um número registrado na API deixa de funcionar no app do WhatsApp (ou no WhatsApp Business) do celular.
  O histórico de conversas, os grupos e as etiquetas do app **não migram** (Meta).
- O CRM ainda **não tem caixa de respostas** para o canal oficial: a resposta do cliente final chega ao
  servidor, mas não é exibida. Se o número principal fosse para a API, o cliente deixaria de ver as respostas.
- A qualidade e o limite diário de mensagens são **por número**. Um número novo isola o risco: se houver
  denúncias, o número principal do negócio não é afetado.

Só migre o número principal depois que existir a caixa de respostas no CRM, e com o cliente ciente de que
perde o app naquele número. O modo de convivência (app Business junto com a API) pode evitar isso, mas
depende de país, requisitos e do cadastro feito pelo próprio cliente (Meta).

## O que dizer ao cliente (resumo)

- "Vamos usar um número novo só para as campanhas. O seu número de sempre não muda."
- "Quem responder a uma campanha cai nesse número novo. Coloque no texto: **para falar com a gente, chame o
  número principal**."
- "Só enviamos para quem deu consentimento. Precisamos da origem da lista."

## Passo a passo

1. **Contrato e consentimento.** Cliente assinou os termos (consentimento dos destinatários, categorias
   proibidas, sem reembolso em caso de restrição do número, retenção e saída). Anotar de onde vem a lista.
2. **Número.** Comprar um chip pré-pago ou usar uma linha fixa que receba SMS ou ligação. Não pode estar
   ativo no app do WhatsApp (Meta). Guardar o contrato/ID do chip com o nome do cliente.
3. **Registrar na conta da Meta (WABA).** Adicionar o número, receber o código (SMS ou voz), definir o
   **nome de exibição** (deve refletir o negócio) e o **PIN de segurança** de 6 dígitos. Guardar o PIN: ele é
   necessário para mover o número depois.
4. **Anotar o `phone_number_id`** do número novo. O token de acesso da conta costuma valer para todos os
   números; só o `phone_number_id` muda por cliente. Verificar se a conta ainda tem vaga de números (a Meta
   limita; peça aumento com a conta verificada).
5. **Cadastrar a sessão do cliente no CRM** (hoje: manual; quem faz é o administrador). Nunca colocar o token
   no repositório; só nas variáveis do servidor ou no cadastro seguro do painel quando existir.
6. **Modelos (templates).** Escrever 2 a 4 modelos do ramo do cliente, em pt_BR, com variáveis
   (`{{1}}` = primeiro nome). Categoria correta: utilidade (lembretes, confirmações) ou marketing
   (promoções). Enviar à Meta e aguardar aprovação (de minutos a dias).
7. **Teste.** Enviar o modelo aprovado para um número seu. Conferir entregue, lido, e o texto recebido.
8. **Saldo e preço.** Definir pacote ou mensalidade, lançar o saldo e configurar o preço por categoria.
9. **Primeira campanha pequena** (dezenas de contatos, só quem deu consentimento). Acompanhar a qualidade
   do número e as respostas antes de ampliar.
10. **Entrega do relatório** ao cliente (enviadas, entregues, lidas, falhas, respostas).

## Sugestões de modelos por ramo

- **Salão:** lembrete de horário (utilidade), confirmação de agendamento (utilidade), promoção do mês
  (marketing), aviso de retorno (marketing), aniversário (marketing).
- **Restaurante:** promoção do dia (marketing), confirmação de reserva (utilidade), novidade no cardápio
  (marketing), pós-venda (utilidade).

## Checklist de entrada (por cliente)

- [ ] Contrato assinado e origem do consentimento registrada
- [ ] Número novo ativo, fora do app do WhatsApp
- [ ] Nome de exibição aprovado
- [ ] PIN de segurança guardado
- [ ] `phone_number_id` anotado e sessão cadastrada
- [ ] Pelo menos 2 modelos aprovados
- [ ] Teste de envio feito
- [ ] Saldo ou plano ativo
- [ ] Texto dos modelos orienta o cliente final a falar com o número principal

## Saída do cliente

Remover o número da conta, entregar o PIN de segurança e a lista de modelos, e apagar os dados conforme o
contrato (LGPD). O número continua sendo do cliente.
