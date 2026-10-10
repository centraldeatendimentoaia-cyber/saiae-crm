# Agente de atendimento do salão (Lavínia) — número por QR code

Atendente de IA que roda **no número do salão (sessão Baileys/QR)**. Não confundir com a IA de vendas do Saiaê, que usa a API oficial.

## O que faz
- **Só responde quem escreve** para o número (evento de mensagem recebida). Nunca puxa conversa.
- Junta mensagens seguidas (7 s) e responde uma vez, com "digitando…" e pausa entre as duas partes.
- Qualifica, tira dúvidas, informa serviços/valores/duração e **chama a recepção** (mensagem "Cliente aguardando resposta - bot" no grupo da recepção) para fechar o agendamento. **Nunca grava, confirma nem promete horário.**
- **Etiqueta** a conversa por interesse (`Interesse: Progressiva | Unhas | Corte/Cor | Promoção`), `Aguardando resposta` ao chamar a recepção, `Vindo de anúncio do Meta` quando a conversa vem de anúncio de clique para WhatsApp e `Sumiu - follow up` ao mandar o lembrete. Nunca remove etiqueta. As etiquetas precisam existir na sessão (botão Sincronizar em Etiquetas).
- **Uma pessoa assumiu** (mensagem escrita pelo celular/WhatsApp Web que não saiu do CRM): a IA se cala por `pausaHoras` (12 h). `#lavinia` digitado na conversa devolve na hora.
- **Follow-up**: uma mensagem 12 h depois da última resposta da IA (que terminou em pergunta), só para quem escreveu e não respondeu, só em horário de atendimento (terça a sábado, 9h–18h), no máximo 5 por rodada e 40 por dia, 1 por silêncio. Nunca quando uma pessoa falou depois da IA.
- Áudio: não ouve; avisa e chama a recepção. Imagem/figurinha sem texto: pede para escrever.
- Respeita o descadastro (SAIR/PARAR) e a lista de números ignorados (equipe/dono). Trava de 10 respostas/hora por contato.

## Como ligar
1. Variáveis no Railway: `ANTHROPIC_API_KEY` e `IA_MODELO` (ou `IA_MODELO_SALAO` só para o salão). Sem elas o agente não responde.
2. Sincronize as etiquetas da sessão e confira os nomes exatos acima.
3. No CRM: **Automação → Agente de atendimento** (escolha a sessão do salão): grupo da recepção, link do Avec, números a ignorar, promoções e (se quiser) edite o texto. Salvar.
4. Ligue a chave "Agente ligado". Desligado por padrão.
5. Desligue respostas automáticas (Resposta automática) deste número, para não responder em dobro.
6. `AGENTE_SALAO=off` desliga tudo no servidor (botão de emergência).

## Custo e limites
Modelo pequeno (Haiku): centavos por conversa; só lê as últimas mensagens. Respostas passam pelo Anti-Spam do número.

## Onde está o código
`src/modules/agente-salao/` — `conhecimento-lavinia.ts` (texto padrão), `motor.ts` (modelo + ferramentas), `agente.ts` (socket), `followup.ts` (lembrete), `estado.ts` (regras), `enviados.ts` (IDs enviados pelo CRM).
