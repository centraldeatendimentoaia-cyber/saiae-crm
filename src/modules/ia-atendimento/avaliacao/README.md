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
