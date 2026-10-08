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
| Cardápio digital + Pix | Link/QR code da loja; Pix online pelo Mercado Pago. Entrega no cardápio é paga **na entrega** (Pix online com entrega ainda não existe, sem data). |
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

## Pontos para você confirmar
1. **NFC-e**: no CLAUDE.md está "nenhuma nota emitida de verdade ainda" (2026-09-26). Se já houve nota real em produção, podemos trocar "em validação" por algo mais firme.
2. **Pix com entrega "em breve"**: está assim no CLAUDE.md; se já saiu, é só atualizar essa linha.
3. **Mercado Pago** como provedor de Pix: citei porque é o único publicado hoje. Prefere não citar?
4. **Preços e planos**: copiados do `planos.ts` (hoje: Essencial R$ 57,90 e Pro R$ 87,90). Confira se não mudaram.
5. **Cadastro do cliente por telefone com código no WhatsApp** (perfil do cliente final): ficou **de fora** porque não confirmei se já está no ar. Se estiver, me diga e eu incluo.
