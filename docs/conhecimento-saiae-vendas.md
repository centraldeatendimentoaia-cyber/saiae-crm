# Conhecimento da atendente de vendas do Saiaê

A fonte de verdade é `src/modules/ia-atendimento/vendas/conhecimento.ts` (a imagem de produção não leva a pasta `docs`, por isso o texto vive no código). Este arquivo só explica como manter. O resumo para o João revisar está em `docs/conhecimento-vendas-para-revisao.md`.

- Origem: `src/lib/planos.ts` e `CLAUDE.md` do repositório da Comanda, em 2026-10-08. Preços e planos na data: Essencial R$ 57,90/mês (anual R$ 49,22/mês), Pro R$ 87,90/mês (anual R$ 70,32/mês), teste grátis de 7 dias com o Pro liberado, um por e-mail.
- A atendente só afirma o que está nesse texto; o que faltar ela encaminha a uma pessoa. **Revise com o João antes de ligar `IA_VENDAS=on`** (cupons, entrega, NFC-e e outros recursos só entram quando confirmados).
- Mudou preço, plano ou funcionalidade na Comanda: atualize o `conhecimento.ts` no mesmo dia (e rode `npm run ia:avaliar`).
