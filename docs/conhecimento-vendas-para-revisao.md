# Conhecimento da atendente de vendas, para o João revisar

Este é o resumo, em português simples, do que a atendente de vendas do Saiaê vai **afirmar**. O texto exato que ela lê está em `src/modules/ia-atendimento/vendas/conhecimento.ts`. Tudo que não está aqui, ela não afirma: diz que vai chamar uma pessoa. Fonte: `planos.ts`, `CLAUDE.md` e os specs do repositório da Comanda, em 2026-10-09.

**Antes de ligar `IA_VENDAS=on`**: leia, corrija o que estiver errado (me diga ou edite o `conhecimento.ts`) e rode `npm run ia:avaliar`.

## O que ela diz que o Saiaê TEM
| Tema | O que ela afirma |
|---|---|
| O que é | Comanda digital para barracas de feira e food service: lança o pedido, a cozinha vê em tempo real, o cliente é chamado pela senha. Tem cardápio digital. |
| Atendimento | Mesa, Balcão, Retirada e Entrega; o dono liga/desliga cada um. No cardápio digital o cliente escolhe Retirada ou Entrega. |
| Cozinha e senha | Cozinha em tempo real com cronômetro; senha com logo da loja, reinicia todo dia. |
| Pagamentos registrados | Pix, dinheiro, débito e crédito. |
| Cardápio digital + Pix | Link/QR code da loja; Pix online pelo Mercado Pago, **inclusive em pedido de Entrega** (ou pagar na entrega). |
| Chamar o entregador | Nos pedidos de Entrega, o dono chama o entregador (motoboy) pelo WhatsApp, direto pelo Saiaê. |
| Cadastro do cliente | Ao fechar o pedido, o cliente se identifica pelo telefone e confirma com um código recebido no WhatsApp (sem senha). |
| Entrega | Taxa por bairro cadastrada pelo dono; a loja pode não entregar em certos bairros. |
| Cupons | O cliente digita o código no cardápio digital; % ou valor fixo; validade, limite total, uma vez por cliente, pedido mínimo; vale só sobre os itens (nunca a taxa de entrega); um por pedido; 100% = pedido grátis; a loja precisa ligar. |
| Impressão | Comanda impressa (automática para pedido do cardápio digital + botão na cozinha); impressora Bluetooth 58/80 mm, **só no app Android**. |
| Nota fiscal | NFC-e pela FocusNFe: o dono cria a conta e sobe o certificado lá; emitida pelo Histórico; taxa de entrega fica fora da nota; Simples e MEI. **Ela avisa que ainda está em validação** e chama uma pessoa. |
| Sem internet | Lançar pedido e cozinha funcionam offline e sobem quando a conexão volta. |
| Estoque e caixa | Estoque simples por item (baixa automática, esgota sozinho, bloqueio opcional) e Caixa simples. |
| IA no WhatsApp | Só nas lojas que ligarem, ainda em teste fechado; **não promete data**. |
| LGPD | O cliente final pode apagar os dados; cadastro de entrega pede consentimento. |
| Planos | Essencial R$ 57,90/mês (anual R$ 49,22/mês); Pro R$ 87,90/mês (anual R$ 70,32/mês), com o que cada um inclui. |
| Teste grátis | 7 dias com o Pro liberado, um por e-mail, pelo link de cadastro. |

## O que ela diz que AINDA NÃO existe (não promete)
Estoque completo (compras, ficha técnica), caixa avançado, app do iPhone na loja de aplicativos. Para iPhone e qualquer coisa fora do texto, ela chama uma pessoa.

## O que ela nunca faz
Fechar venda, cobrar, pedir dados de pagamento, prometer desconto ou prazo, mandar qualquer link que não seja o de cadastro (`IA_VENDAS_LINK_CADASTRO`).

## Respostas do João (2026-10-09), já aplicadas no texto
1. **NFC-e**: sem resposta → continua "em validação" (ela chama uma pessoa se perguntarem de nota fiscal).
2. **Pix com entrega**: já funciona, com chamada para o motoboy → incluído.
3. **Mercado Pago**: pode citar → mantido.
4. **Preços e planos**: estão certos (Essencial R$ 57,90, Pro R$ 87,90) → mantidos.
5. **Cadastro do cliente por telefone com código no WhatsApp**: já funciona → incluído.

## Correções do João (2026-10-09), aplicadas
- **Oferta do panfleto**: quem chega pelo panfleto ("Quero ser testador do sai aê") ganha **30 dias grátis**; dando feedback do produto ganha **mais 30 dias grátis do plano Essencial**. O bot não libera nem cobra: diz que a equipe confirma e libera, e chama a equipe (motivo `feedback_bonus`). Quem não veio do panfleto segue o teste padrão de **7 dias** e não recebe a oferta.
- **Identidade**: o bot é o **"atendente IA do Sai aê"** ("Oi! Sou o atendente IA do Sai aê"). Nunca se chama de assistente automático/virtual, robô ou bot. Se perguntarem, diz que é uma IA. Só vale para vendas; as lojas não mudaram.
- Ponto a confirmar: de qual plano são os 30 dias iniciais do panfleto (o texto diz só "30 dias grátis").
- **Desconto/negociação**: o bot não responde sozinho; pedido de desconto, promoção, cupom para si, "mais barato" ou condição especial vai direto para a equipe, com uma resposta fixa que não concede nada.
