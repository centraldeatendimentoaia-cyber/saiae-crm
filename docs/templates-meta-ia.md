# Template da Meta para a IA: `ia_chamar_dono`

A IA avisa o responsável da loja por **template aprovado** (o responsável quase nunca está dentro da janela de 24 h).
Crie no WhatsApp Manager da Meta antes de ligar a IA (nada disso é feito pelo código).

| Campo | Valor |
|---|---|
| Nome | `ia_chamar_dono` |
| Categoria | Utilidade (UTILITY) |
| Idioma | Português (BR) `pt_BR` |
| Botões | nenhum |

Corpo sugerido (4 variáveis, nesta ordem):

```
Atendimento da IA na loja {{1}}: um cliente precisa de você ({{2}}). Cliente: {{3}}. Fale com ele direto pelo WhatsApp. Para a IA voltar a atender, responda aqui: LIBERAR #{{4}}
```

Exemplo para a aprovação: `Açaí do Zé`, `reclamação`, `5511999990001`, `ABC234`.

- {{1}} nome da loja, {{2}} motivo (dúvida que a IA não soube responder / reclamação / assunto sensível / cliente pediu atendimento humano), {{3}} telefone do cliente, {{4}} código da loja.
- Sem texto promocional (senão a Meta reclassifica como Marketing).

## Como funciona

1. A IA chama `chamar_dono` → este template vai para o `whatsapp_dono` da loja (vem da Comanda) e a conversa pausa por **12 h**: a IA fica calada; o cliente recebe **uma** vez "o responsável já foi avisado".
2. Passadas 12 h a IA volta sozinha na próxima mensagem do cliente.
3. O responsável pode devolver antes respondendo ao número da loja com `LIBERAR #CODIGO`. Só vale se o remetente for exatamente o WhatsApp do responsável cadastrado na Comanda para aquela loja; devolve todas as conversas pausadas daquela loja. De qualquer outro número a mensagem é tratada como cliente comum.
4. Loja sem WhatsApp do responsável válido: a IA não consegue chamar, não pausa e diz ao cliente que a loja responderá assim que possível.

Variáveis de ambiente (Railway, definidas pelo dono): `IA_ATENDIMENTO=on`, `IA_MODELO`, `ANTHROPIC_API_KEY`, `COMANDA_IA_SEGREDO`, `COMANDA_IA_URL` e as da Cloud API. Sem `IA_MODELO` ou `ANTHROPIC_API_KEY` a IA só registra mensagens e não responde.
