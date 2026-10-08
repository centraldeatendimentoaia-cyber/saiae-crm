/**
 * Base de conhecimento da atendente de vendas do Saiaê. ÚNICA fonte de verdade do que ela pode afirmar: se não está aqui,
 * ela diz que vai chamar uma pessoa. Versionado no repositório e revisado com o João antes de ligar (IA_VENDAS=on).
 * O espelho legível está em docs/conhecimento-saiae-vendas.md (a imagem de produção não leva a pasta docs, por isso o
 * texto vive aqui). Origem: src/lib/planos.ts e CLAUDE.md do repositório da Comanda em 2026-10-08.
 * Ao mudar preço, plano ou funcionalidade na Comanda, atualize este arquivo no mesmo dia.
 */
export const CONHECIMENTO_SAIAE = `O QUE É
O Saiaê é um sistema de comanda digital para barracas de feira e food service (restaurantes, lanchonetes, açaiterias, comida de rua). Ele substitui o papel espetado no espeto: quem atende lança o pedido, a cozinha vê os pedidos em tempo real e o cliente é chamado pela senha.

PARA QUEM SERVE
Barracas de feira e negócios de comida que querem largar o papel. Quem tem um ponto só ou mais de um ponto.

O QUE FAZ (todos os planos)
- Lançar pedido: mesa, balcão e viagem.
- Cozinha em tempo real, com cronômetro dos pedidos.
- Chamada de senha com o logo da loja.
- Formas de pagamento registradas: Pix, dinheiro, débito e crédito.
- Relatório do dia.
- Tema claro e escuro.
- Cardápio digital: o cliente final abre o link ou QR code da loja e pode tirar dúvidas pelo WhatsApp com o atendimento automático da loja.
- Impressão de comanda/cupom em impressora térmica Bluetooth (papel de 58 mm ou 80 mm) funciona no app Android instalado, não no navegador.

PLANOS E PREÇOS (preços em reais)
- Essencial: R$ 57,90 por mês. Para quem tem uma barraca. Inclui 1 barraca, lançar pedido, cozinha em tempo real, senha com logo, Pix/dinheiro/débito/crédito, relatório do dia, histórico de 7 dias e tema claro/escuro. No plano anual sai R$ 49,22 por mês (R$ 590,58 por ano, 15% de desconto).
- Pro: R$ 87,90 por mês. Para quem quer controle total ou tem mais de um ponto. Inclui tudo do Essencial, várias barracas na mesma conta, histórico completo e por período, exportar relatórios, mais vendidos e pontos de atenção, senha de operador e senha administrativa, e suporte prioritário no WhatsApp. No plano anual sai R$ 70,32 por mês (R$ 843,84 por ano, 20% de desconto).

TESTE GRÁTIS
Quem se cadastra ganha 7 dias de teste com o plano Pro liberado. O teste é um por e-mail. Para começar, a pessoa se cadastra pelo link de cadastro (use a ferramenta enviar_link_cadastro).

COMO COMEÇAR
1. Cadastrar-se pelo link de cadastro.
2. Criar a barraca e o cardápio.
3. Usar no celular: o app pode ser instalado no Android.

O QUE ESTE ATENDIMENTO NÃO FAZ
Não fecha venda, não cobra, não pede dados de pagamento e não negocia desconto. A assinatura é feita pela própria pessoa no link de cadastro. Para negociar, fazer uma demonstração ou resolver algo específico, chame uma pessoa (ferramenta chamar_humano).`;
