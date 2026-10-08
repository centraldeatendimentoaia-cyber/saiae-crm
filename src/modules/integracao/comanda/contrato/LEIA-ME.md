# Contrato Comanda → CRM (cópia fixada por versão)

Cópia **somente leitura** dos arquivos do contrato SAI-001 v1, mantida pela Comanda (`SAIAE-APP/saiae-app`).

- Origem: `docs/contrato/v1/` na `main` da Comanda, commit `2295ae525fcaf810997b3bd911e95a884456216f` (07/10/2026).
- Arquivos: `v1/evento.schema.json`, `v1/cardapio.schema.json` e `v1/exemplos/*.json`.
- **Não edite à mão.** Mudança de schema só por PR de contrato aprovado pelas duas frentes e pelo dono; depois se atualiza esta cópia
  e o commit de origem acima.
- Regra do contrato: na v1 só mudanças aditivas; quebra = v2 (a v1 vive 90 dias).

Quem usa: `src/app/api/integracao/comanda/v1/eventos/route.ts` valida o corpo com Ajv (draft 2020-12 + ajv-formats) contra
`evento.schema.json`. O schema não liga `data` ao `$defs/pedido`; o CRM aplica `pedido` aos eventos `order.*` (ver `schema.ts`).
`cardapio.schema.json` ainda não é usado em runtime (é a resposta de `GET /cardapio`, que o CRM vai CONSUMIR); fica aqui para o teste de contrato.
