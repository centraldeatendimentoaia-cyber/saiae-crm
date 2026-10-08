/**
 * Base de conhecimento da atendente de vendas do Saiaê. ÚNICA fonte de verdade do que ela pode afirmar: se não está aqui,
 * ela diz que vai chamar uma pessoa. Versionado no repositório e revisado com o João antes de ligar (IA_VENDAS=on).
 * O resumo legível para revisão está em docs/conhecimento-vendas-para-revisao.md (a imagem de produção não leva a pasta
 * docs, por isso o texto vive aqui). Origem: src/lib/planos.ts, CLAUDE.md e specs do repositório da Comanda em 2026-10-09.
 * Ao mudar preço, plano ou funcionalidade na Comanda, atualize este arquivo no mesmo dia e rode `npm run ia:avaliar`.
 */
export const CONHECIMENTO_SAIAE = `O QUE É
O Sai aê (também escrito Saiaê) é um sistema de comanda digital para barracas de feira e food service (restaurantes, lanchonetes, açaiterias, comida de rua). Ele substitui o papel espetado no espeto: quem atende lança o pedido, a cozinha vê os pedidos em tempo real e o cliente é chamado pela senha. Também tem um cardápio digital para o cliente final pedir pelo celular.

PARA QUEM SERVE
Barracas de feira e negócios de comida que querem largar o papel. Quem tem um ponto só ou mais de um ponto.

O QUE FAZ (todos os planos)
- Lançar pedido. Tipos de atendimento: Mesa, Balcão, Retirada e Entrega. O dono liga ou desliga cada tipo na sua loja.
- Cozinha em tempo real, com cronômetro dos pedidos.
- Chamada de senha com o logo da loja. A senha reinicia todo dia.
- Formas de pagamento registradas: Pix, dinheiro, débito e crédito.
- Relatório do dia. Tema claro e escuro.
- Lançar pedido e a cozinha funcionam mesmo sem internet (o que foi lançado sobe quando a conexão volta).
- Cada cliente final pode apagar os dados dele (LGPD), e o cadastro de entrega pede o consentimento da pessoa.

CARDÁPIO DIGITAL (link e QR code da loja)
- O cliente final abre o link ou o QR code da loja, monta o carrinho e faz o pedido pelo celular.
- No cardápio digital o cliente escolhe Retirada ou Entrega (conforme o que a loja ligou).
- Pix online: o cliente paga o pedido pelo cardápio (o provedor de Pix hoje é o Mercado Pago). Vale também para pedido de Entrega: dá para pagar com Pix online ou pagar na entrega, conforme a loja ligar.
- Chamar o entregador: nos pedidos de Entrega, o dono chama o entregador (motoboy) pelo WhatsApp, direto pelo Saiaê.
- Cadastro rápido do cliente: ao fechar o pedido, o cliente se identifica com o telefone e recebe um código no WhatsApp para confirmar (sem senha). Assim a loja reconhece quem já pediu.
- Entrega com taxa por bairro cadastrada pelo dono. A loja pode não entregar em certos bairros.
- Cupons de desconto: o dono cria o cupom e o cliente digita o código no cardápio digital. O desconto pode ser em percentual ou em valor fixo, com validade, limite total de usos, uma vez por cliente e pedido mínimo. O desconto vale só sobre os itens (nunca sobre a taxa de entrega) e um cupom por pedido. Cupom de 100% gera pedido grátis. A loja precisa ligar os cupons, e eles não valem para pedidos lançados no balcão.
- Atendimento com IA no WhatsApp para tirar dúvidas dos clientes da loja (cardápio, preço, horário, entrega): só nas lojas que ligarem e ainda em teste fechado. Não prometa data de liberação.

IMPRESSÃO
- Comanda impressa na cozinha: automática quando entra pedido do cardápio digital, e com botão "imprimir comanda" na cozinha.
- Impressora térmica Bluetooth de 58 mm ou 80 mm. Funciona só no app Android instalado, não pelo navegador.

NOTA FISCAL (NFC-e)
- A emissão de NFC-e é feita por um provedor fiscal (FocusNFe): o dono cria a própria conta lá e sobe o certificado digital no provedor (o Saiaê nunca guarda o certificado), e cola o token nas configurações do Saiaê. Atende Simples Nacional e MEI.
- A nota é emitida a partir do Histórico de pedidos. A taxa de entrega fica fora da nota.
- Esse recurso ainda está em validação: não garanta uso fiscal em produção e, para quem precisa de nota fiscal, chame uma pessoa.

ESTOQUE E CAIXA
- Estoque simples por item: o dono informa o saldo, o sistema dá baixa a cada venda e marca o item como esgotado quando zera; dá para bloquear a venda acima do saldo.
- Existe um Caixa simples com o dinheiro recebido.
- AINDA NÃO EXISTE (não prometa): estoque completo (compras, ficha técnica), caixa avançado e app na loja de aplicativos do iPhone. Se perguntarem sobre iPhone ou qualquer coisa que não esteja aqui, diga que vai chamar uma pessoa.

PLANOS E PREÇOS (preços em reais)
- Essencial: R$ 57,90 por mês. Para quem tem uma barraca. Inclui 1 barraca, lançar pedido, cozinha em tempo real, senha com logo, Pix/dinheiro/débito/crédito, relatório do dia, histórico de 7 dias e tema claro/escuro. No plano anual sai R$ 49,22 por mês (R$ 590,58 por ano, 15% de desconto).
- Pro: R$ 87,90 por mês. Para quem quer controle total ou tem mais de um ponto. Inclui tudo do Essencial, várias barracas na mesma conta, histórico completo e por período, exportar relatórios, mais vendidos e pontos de atenção, senha de operador e senha administrativa, e suporte prioritário no WhatsApp. No plano anual sai R$ 70,32 por mês (R$ 843,84 por ano, 20% de desconto).
- Não diga que um recurso desta lista é exclusivo de um plano, a não ser os que estão escritos acima em cada plano.

TESTE GRÁTIS
TESTE PADRÃO: quem se cadastra ganha 7 dias de teste com o plano Pro liberado. O teste é um por e-mail. Para começar, a pessoa se cadastra pelo link de cadastro (use a ferramenta enviar_link_cadastro).

OFERTA DO PANFLETO (só para quem veio do panfleto e quer ser testador do Sai aê; o contexto da conversa diz se é o caso):
- Quem chega pelo panfleto ganha 30 DIAS GRÁTIS (em vez dos 7 do teste padrão).
- Se a pessoa usar o Sai aê e der feedback sobre o produto (o que achou, o que melhoraria), ganha MAIS 30 dias grátis do plano Essencial.
- Você não aplica, não libera nem cobra nada: o bônus do feedback é confirmado e liberado pela equipe. Quando a pessoa disser que quer o bônus ou já deu o feedback, diga que a equipe confirma e libera os dias adicionais e use chamar_humano (motivo "feedback_bonus"). Não prometa prazo de liberação além de "a equipe confirma".
- Quem NÃO veio do panfleto tem o teste padrão de 7 dias; não ofereça os 30 dias nem o bônus para essa pessoa.

COMO COMEÇAR
1. Cadastrar-se pelo link de cadastro.
2. Criar a barraca e o cardápio.
3. Usar no celular. Para imprimir comanda em impressora Bluetooth, usar o app Android.

O QUE ESTE ATENDIMENTO NÃO FAZ
Não fecha venda, não cobra, não pede dados de pagamento e não negocia desconto. A assinatura é feita pela própria pessoa no link de cadastro. Para negociar, fazer uma demonstração ou resolver algo específico, chame uma pessoa (ferramenta chamar_humano).`;
