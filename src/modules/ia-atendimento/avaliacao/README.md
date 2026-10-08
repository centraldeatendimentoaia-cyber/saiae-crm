# Bateria de avaliação da IA (`npm run ia:avaliar`)

Roda ~22 mensagens de cliente (preços, taxa, horário, esgotado, reclamação, alergia e ataques: injeção de prompt,
pedido de desconto, vazamento do prompt, dados de outro cliente, nome do perfil / texto do dono / descrição do item
maliciosos, link externo) contra uma **loja fictícia** e o **mesmo motor da produção**. Cada caso tem uma checagem
fixa (sem outro modelo julgando). Não toca em banco, Meta nem Comanda, e as ações (chamar o responsável) são simuladas.

## Como rodar (no computador do João)

1. Crie o arquivo `.env.avaliacao` na raiz do projeto (já fica fora do git):
   ```
   ANTHROPIC_API_KEY=...sua chave...
   IA_MODELO=...nome do modelo...
   ```
   (ou defina as duas variáveis no terminal). A chave nunca é impressa.
2. `npm run ia:avaliar` (só um caso: `npm run ia:avaliar -- --caso=desconto`).
3. Saída: `OK` / `FALHA [categoria] nome - motivo` por caso e um resumo. Código de saída 0 = tudo passou, 1 = algum falhou, 2 = faltou configuração.
   O relatório não mostra as mensagens nem as respostas, só o nome do caso e o motivo.

Custo: cerca de 22 a 60 chamadas curtas ao modelo escolhido em `IA_MODELO`.

## Regra de ouro

Os casos de **segurança** precisam passar 100% antes de ligar a IA para qualquer loja. Falha de qualidade (ex.: não somou o
adicional) merece ajuste do prompt, mas não bloqueia. Modelo é probabilístico: se um caso falhar, rode de novo com `--caso=` para ver se é consistente.

## Adicionar um caso

Em `casos.ts`: `nome`, `categoria`, `mensagem`, (opcional `nomePerfil` / `ctx`) e `verificar(execucao)`, que devolve `null` se passou ou o motivo da falha. Sempre
use dados inventados.

## Casos de vendas (atendente de vendas do Saiaê)

Além dos casos das lojas, a bateria roda `casos-vendas.ts` (21 casos, mesmo motor e mesmo conhecimento da produção, link de cadastro de exemplo `https://saiae.com.br/raio-x`): preços dos planos, teste grátis, cupons, impressora, levar ao link de cadastro, "quero pedir comida" (orientar a usar o link da loja), e a segurança: desconto/negociação (precisa chamar uma pessoa), cobrança e chave Pix, pedir dado sensível, recurso inventado (iFood, boleto), app do iPhone, NFC-e (não garantir), data da IA no WhatsApp (não prometer), preço inventado, injeção de prompt, vazar o prompt, nome do perfil malicioso e link externo. `npm run ia:avaliar -- --caso=vendas-` roda só os de vendas. Os casos de segurança também precisam passar 100% antes de ligar `IA_VENDAS=on`. Se o conhecimento (`vendas/conhecimento.ts`) mudar, rode a bateria de novo.

## Custo da rodada e comparação de modelos

Cada rodada completa gasta dinheiro real (dezenas de chamadas). **Rode no máximo uma vez por mudança.** No fim a bateria imprime `Uso:` com chamadas, tokens de entrada (novos, lidos do cache e escritos no cache), tokens de saída e o **custo estimado** (tabela de preços em `avaliacao/custo.ts`; é estimativa, confira na página de preços da Anthropic; modelo fora da tabela mostra só tokens).

`npm run ia:avaliar -- --modelo=claude-haiku-5-5` troca o modelo só nessa rodada (o `IA_MODELO` de produção não muda), para comparar custo e casos que falham. Erro de API (ex.: sem créditos) deixa o caso **inválido**, nunca "passou".

## Cache de prompt

O prompt vai ao modelo em dois blocos: o **estável** (regras, dados da loja, cardápio, texto do dono; ou regras e conhecimento de vendas) com `cache_control`, e o **variável** (hora, apresentação, nome no WhatsApp, cliente, "aberta agora"), que fica depois e não invalida o cache. As ferramentas também levam `cache_control`. O cache dura 5 minutos; só ajuda quando há várias mensagens da mesma loja no período. Se você mudar o prompt, mantenha tudo que varia por mensagem na parte variável.
