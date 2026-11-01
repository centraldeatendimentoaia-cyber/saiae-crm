# CRM neutro: atendente de IA treinável, métricas de crescimento e troca de sessão segura

Data: 2026-11-01. Estado: **rascunho para aprovação do João**. Nada foi construído.

## 1. Intenção

O João quer um CRM único que o acompanhe em qualquer negócio (salão, clínica, agência, o que vier), sem que um salão precise usar métricas de clínica e sem que uma agência receba uma "atendente de salão". Ele vai passar a vender o serviço (atendente de IA no WhatsApp mais relatório de crescimento) para clientes externos. Hoje ele sente o CRM travado: foi crescendo por acréscimo, mistura conceitos de salão no código e a troca de sessão no painel não dá retorno nenhum.

Quatro entregas, em um só desenho:

- **A. Troca de sessão segura**: loading com o nome da sessão e nenhuma chance de dado de uma sessão aparecer ou ser salvo em outra.
- **B. Atendente de IA neutra e totalmente treinável** pelo dono do negócio: tira dúvidas simples, **fecha venda** e chama uma pessoa nas dúvidas maiores.
- **C. Métricas de crescimento** para mostrar ao cliente o quanto o atendimento escalou **em relação ao mês anterior**, em todos os âmbitos do WhatsApp.
- **D. Investigação das respostas automáticas** que, segundo o João, não saem quando o CRM está aberto.

## 2. Metas, não-metas, anti-metas

Metas
- Um negócio novo é configurado pela tela, sem tocar no código.
- O dono treina a atendente sozinho, testa antes de publicar e vê o efeito.
- O João mostra ao cliente um comparativo mês a mês que o cliente entende em um minuto.
- Os negócios que já rodam (salão da LAVI) continuam respondendo **exatamente** como hoje.

Não-metas
- Não treinar nem ajustar modelo (fine-tuning). Explicação na seção 5.
- Não criar um CRM de pipeline comercial completo (propostas, contratos). Só o necessário para fechar venda pelo WhatsApp.
- Agendamento direto em agenda externa (Google Agenda) fica para depois.

Anti-metas (falha mesmo que "funcione")
- Qualquer alteração que quebre a integração com a Comanda do Sai aê.
- A IA inventar preço, prazo, desconto, link ou promessa que o dono não escreveu.
- A IA dar diagnóstico, orientação clínica ou jurídica, ou prometer resultado.
- Dado ou configuração de um cliente aparecer, ou ser gravado, em outro.

## 3. Restrições

1. **Zona Sai aê, intocável** (conferir no diff de todo PR): `src/app/api/integracao/comanda/v1/*`, `src/modules/integracao/comanda/*`, `src/modules/bot-pedidos/*`, `src/modules/ia-atendimento/*`, `src/modules/disparos/*`, Stripe (`stripe-billing`, `plans`), tabelas `BarracaSessao`, `AvisoPedido`, `Ia*`, `Disparo*`, `AvaliacaoPedido`. O módulo `ia-atendimento` (IA de vendas do próprio Sai aê) não é reaproveitado nem alterado.
2. **Banco:** o start roda `prisma db push`, então o schema vai para produção no deploy. Só tabelas novas e colunas opcionais ou com default. Nunca renomear, apagar ou mudar tipo.
3. **Núcleo compartilhado só recebe acréscimo:** `Message`, `Contact`, `Session`, `Label`, `ChatLabel`, `AgenteConfig`, `AgenteConversa`, `src/modules/whatsapp/*`. Comportamento existente não muda.
4. Duas chaves de sessão convivem e já causam confusão: `Session.id` (cuid, usado em `Message`) e `Session.sessionId` (string do Baileys, usado em `AgenteConfig`, `BarracaSessao`, `AgenteConversa`). Código novo usa só `sessionId` (Baileys) na API e converte dentro da camada de dados.
5. CI verde (`npm run typecheck`, `npm test`, `npm run build`), todo código novo com teste, teste primeiro no ambiente staging do Railway. Interface em PT-BR.
6. Uma sessão ligada a barraca (`BarracaSessao`) nunca pode ter a atendente ativa, porque dois bots responderiam o mesmo cliente. Trava na API de configuração e na hora de responder.

## 4. A. Troca de sessão segura (achados no código)

- `session-provider.tsx:68`: `setSessionId` só troca o estado e o cookie e chama `router.refresh()`. Não há indicador nenhum.
- `chat/page.tsx` lê o cookie no servidor e recria a tela por sessão (`key`), e troca bem. As páginas de cliente (`agente-ia`, `autoreply`, `labels`, `contacts`, `groups`, `webhooks`, `descadastros`, `profile`, `broadcast`) refazem o fetch, mas **mantêm os dados da sessão anterior na tela até a resposta chegar**. `scheduler`, `settings` e `sticker` usam a sessão e não refazem nada na troca.
- Risco real: em `agente-ia/page.tsx` (`carregar`), se o fetch da sessão nova falhar, a tela segue mostrando a configuração da antiga, e `salvar` grava essa configuração **na sessão nova** (liga, desliga ou sobrescreve o atendente da sessão errada).
- `SessionGuard` existe e não é usado no layout.

Comportamento desejado: ao escolher outra sessão aparece uma tela cheia curta, "Entrando em **<nome da sessão>**…". Enquanto ela carrega, todo o estado das páginas é descartado (as páginas são recriadas por sessão) e os botões de salvar ficam desabilitados. Se o carregamento falhar, a tela mostra o erro e **nunca** o dado da sessão anterior. Teste automatizado: trocar de sessão com a segunda falhando não pode permitir salvar.

## 5. B. Atendente neutra e treinável

### Como se treina uma atendente de IA (decisão de abordagem)

Não se ensina a atendente alterando o modelo. Para atendimento de negócio pequeno, o que funciona e é controlável é dar **contexto bom, regras claras, exemplos reais e um jeito de testar**. Fine-tuning é caro, difícil de corrigir ("ela aprendeu errado, como desaprende?") e atrasa cada ajuste. O treinamento é feito em camadas que o dono edita por tela, na ordem de impacto:

1. **Identidade e tom**: nome da atendente, nome do negócio, como se apresenta, jeito de falar, uso de emoji.
2. **Base de conhecimento** (fonte única do que ela pode afirmar): serviços ou produtos, preços, política de pagamento e cancelamento, endereço, horários, perguntas frequentes. Em seções editáveis, cada uma com data de atualização. O que não está aqui, ela não afirma: encaminha.
3. **Roteiro de venda**: etapas configuráveis (entender a necessidade, apresentar a opção certa, tratar objeção, fechar), o que conta como "venda fechada" e a próxima ação em cada etapa.
4. **Regras de passagem para pessoa**: lista de gatilhos que o dono liga, desliga e amplia (reclamação, desconto fora da regra, pedido de humano, assunto sensível de saúde ou jurídico, valor acima de um limite, áudio, três respostas sem avançar). Cada gatilho tem a frase fixa de transição.
5. **Exemplos de conversa**: pares "cliente disse / atendente ideal respondeu" e também "nunca responda assim". É o jeito mais forte de ajustar tom e decisões.
6. **Laboratório e aprendizado com correção**:
   - **Chat de teste** na tela, que usa a configuração em edição sem enviar nada ao WhatsApp.
   - **Reprodução de conversas reais** (do histórico da sessão) para ver o que a atendente responderia hoje, antes de publicar.
   - **Aprender com a correção**: quando uma pessoa assume e responde, o CRM sugere "transformar em exemplo" ou "adicionar à base", e o dono aprova com um clique. Nada entra sozinho.
   - **Versões**: cada publicação guarda a versão; dá para voltar à anterior.

Base grande demais para caber inteira no contexto da IA (catálogo extenso) usa busca por trechos. Começar sem isso, com limite de tamanho claro na tela.

### Venda e dúvidas

- A atendente responde dúvidas simples só com o que está na base. O que estiver fora dela, ou bater em um gatilho, vira passagem para pessoa com resumo (nome, interesse, o que já foi dito), no canal que o negócio escolheu (grupo de WhatsApp e/ou e-mail), mais a etiqueta "aguardando".
- **Fechar venda** (decisão do João): a IA **quebra as objeções** do cliente usando o banco de objeções do dono e **direciona para a venda ou para o agendamento**. O desfecho é o link que o dono configurou (agendamento, compra ou pagamento) ou a passagem para uma pessoa com resumo, quando o negócio fecha por conversa. O CRM não processa pagamento nesta entrega.
- **Banco de objeções** (camada de treino): lista editável de "o cliente diz (ex.: está caro, vou pensar, preciso falar com meu marido) → como responder → próximo passo". Objeção que não está no banco: a IA reconhece, responde só com o que a base permite, tenta uma vez conduzir ao próximo passo e, se o cliente insistir, passa para uma pessoa. Nunca inventa desconto, prazo ou condição.
- **Follow-up de quem parou de responder**: já existe uma versão (`followup.ts`, `followUpHoras`, etiqueta "Sumiu - follow up"). Passa a ser configurável por negócio: sequência de até N mensagens (padrão 2), intervalo entre elas, texto de cada uma (com `{nome}`), respeito ao expediente e ao descadastro (`bindOptOut`), parada automática quando o cliente responde ou uma pessoa assume. Reativações geradas entram nas métricas.
- A IA só usa links, preços e condições escritos pelo dono (regra já presente no motor atual e mantida). Entrada do cliente continua tratada como dado, nunca como instrução.
- Toda venda fechada pela IA é registrada (quem, o quê, valor informado, data) para entrar nas métricas.

### Neutralidade (sair do "salão")

- O motor atual (`src/modules/agente-salao/*`) mistura regras genéricas com as de salão: ferramenta `chamar_recepcao`, motivos fixos (`maquiagem_penteado`, `clube_tati`), etiquetas de interesse de salão, nome padrão "Lavínia", dias abertos "terça a sábado", follow-up "do salão" e `salaoAberto`.
- Novo módulo `src/modules/atendente/` com motor sem vocabulário de setor: ferramentas `passar_para_pessoa` (motivos vêm da configuração), `etiquetar`, `enviar_link` (agendamento ou pagamento, lidos da configuração) e `registrar_venda`. Textos fixos (transição, áudio, só texto) vêm da configuração, com padrão neutro.
- **Modelos prontos** ("Salão", "Clínica", "Agência", "Em branco") são apenas conjuntos de valores iniciais (base de exemplo, gatilhos, etiquetas, vocabulário, expediente) que preenchem as telas. Nada específico de setor fica no código.
- **Compatibilidade com o que roda hoje:** as sessões existentes mantêm o comportamento atual até serem migradas. A migração aplica o modelo "Salão" com os valores que a sessão já tem (por exemplo o conhecimento da LAVI) e é verificada por teste que compara a resposta antes e depois com as mesmas conversas. `AgenteConfig` e `AgenteConversa` seguem existindo; colunas novas são opcionais. O módulo antigo só é removido quando nenhuma sessão depender dele (decisão do João, fora desta entrega).

## 6. C. Métricas de crescimento

Objetivo: o João abre a página de um cliente, escolhe o mês e vê o **comparativo com o mês anterior** (variação em % e em número), pronto para mostrar ou enviar ao cliente.

Medidas, todas por sessão e período, com comparação ao período anterior de mesma duração:

| Âmbito | Como é medido |
|---|---|
| Mensagens recebidas e enviadas | `Message` |
| **Clientes novos** | contatos cuja primeira mensagem na sessão cai no período |
| **Clientes de anúncio** | conversas cuja primeira mensagem tem origem de anúncio (`externalAdReply` ou `conversionSource`; `referral` na API oficial). Hoje isso só vira uma etiqueta; é preciso **gravar a origem** em tabela nova para poder contar |
| **Reativação** | contatos sem conversa há N dias (padrão 30, configurável) que voltaram a falar no período, e respostas a follow-up |
| Demandas, **tempo de primeira resposta** (mediana e p90), dentro e fora do expediente | regras da seção 6.1 |
| Sem retorno e pendentes | demanda sem resposta em X horas (padrão 24) |
| IA x pessoa | origem da resposta (`MensagemOrigem`) |
| Vendas fechadas pela IA, passagens para pessoa | registros da atendente |
| Horário de pico | matriz dia da semana x hora |

O vocabulário dos textos da tela ("clientes", "pacientes", "leads") é configurável por sessão.

### 6.1 Regras de cálculo (função pura, testada)

- Ignorar grupos, `status@broadcast`, `@broadcast` e `@newsletter`.
- **Demanda** começa na primeira mensagem recebida do contato, ou na primeira recebida depois de uma resposta nossa; recebidas seguidas pertencem à mesma demanda.
- **Primeira resposta** é a primeira mensagem enviada depois do início da demanda; `tempo = resposta - início`.
- **Sem retorno**: sem resposta em até `horasSemRetorno`. Se o prazo não venceu no fim do período, é **pendente**.
- **Fora do expediente**: iniciada fora dos dias e horas da configuração, no fuso `America/Sao_Paulo`.

### 6.2 Dados novos (somente acréscimo)

- `MensagemOrigem(sessionId, keyId, origem "ia"|"crm"|"humano", criadoEm)`, única por `(sessionId, keyId)`. Mensagem enviada sem linha aqui é de pessoa pelo celular. Gravação não bloqueante com `try/catch`. Limpeza na rotina de retenção existente (`MESSAGE_RETENTION_DAYS`).
- `ConversaOrigem(sessionId, jid, origem "anuncio"|"organico", criadoEm)` para clientes de anúncio.
- `VendaIA(sessionId, jid, descricao, valorCentavos?, criadoEm)` para vendas fechadas.
- Sem colunas novas em `Message` ou `Contact`.

### 6.3 Entrega

- `GET /api/metricas/[sessionId]?de=&ate=&comparar=1`: autorização `getAuthenticatedUser` + `canAccessSession`, período máximo de 92 dias, resposta sem conteúdo de mensagem nem telefone, `?formato=csv` opcional.
- Página `/dashboard/metricas`: cartões com variação, mapa de calor, série diária, estados vazios, funciona no celular, exporta CSV. O modo "antes x depois" (semana sem IA x semana com IA) é o mesmo comparativo com dois períodos livres.
- Relatório mensal para o cliente (decisão do João: ele envia **em texto pelo WhatsApp**): botão "Copiar resumo" que gera um texto pronto, em PT-BR, com os números do mês, a variação contra o mês anterior e uma frase por âmbito, para o João colar na conversa. Sem link público, sem token e sem página de leitura nesta entrega. Nenhum nome, telefone ou mensagem de cliente final entra no texto.

## 7. D. Respostas automáticas que "não saem com o CRM aberto"

Resultado da leitura do código (não reproduzido em execução):

- `store/autoreply.ts` não depende de haver navegador conectado. O painel aberto só aciona `io.emit` para a tela e leituras (`/read`, `/presence`).
- Causas plausíveis a testar: teste feito com o próprio número da sessão (`canAutoReply` ignora `fromMe` no modo `ALL`); fila do anti-spam com atraso longo (`antispam.ts`); **duas instâncias do CRM (staging e produção) com a mesma sessão**, o que faz o WhatsApp derrubar uma delas; sessão selecionada no painel diferente da testada (problema A).
- Procedimento: reproduzir no staging com os logs `AutoReply` e `BAILEYS_LOG_LEVEL` ligados, com o painel aberto e fechado, registrando se `messages.upsert` chega e se `sendMessage` é chamado. Só se corrige o que for reproduzido, e a correção entra com teste de regressão.

## 8. Ordem de entrega

1. **A** troca de sessão segura (pequeno, devolve a confiança no resto).
2. **D** diagnóstico das respostas automáticas, em paralelo, só leitura até reproduzir.
3. Trava de barraca x atendente (restrição 6) e `MensagemOrigem`.
4. Função de métricas, API e página (**C**), com origem de anúncio e reativação.
5. Atendente neutra (**B**): módulo novo, modelos prontos, telas de treino, chat de teste, migração das sessões existentes com teste de equivalência.
6. Resumo copiável para WhatsApp, `VendaIA` e follow-up configurável.

Um PR por etapa. C (só leitura) pode ser publicado antes de B.

## 9. Critérios de aceite

- Diff sem nenhum arquivo da zona Sai aê (seção 3, item 1) e schema só com tabelas novas ou colunas opcionais.
- Troca de sessão mostra o nome da sessão; com a nova sessão falhando, nada da antiga fica visível nem salvável.
- Sessão de barraca não ativa o atendente; sessões existentes respondem como antes (teste de equivalência).
- Um negócio novo (por exemplo uma agência) é configurado só pela tela, e a atendente não usa nenhum termo de salão.
- Conversa simulada mostra: dúvida respondida só com a base, venda fechada registrada, gatilho passando para pessoa com resumo, tudo refletido nas métricas e no comparativo com o mês anterior.
- `typecheck`, `test` e `build` verdes; testes cobrem as regras da 6.1, os gatilhos de passagem e a anti-mistura de sessões.

## 10. O que ficou aberto

Pendências que dependem do João: nenhuma. P1 (fechar venda = quebrar objeções e direcionar para venda ou agendamento, mais follow-up) e P2 (relatório enviado em texto pelo WhatsApp) foram respondidas e entraram nas seções 5 e 6.3.

Escolhas minhas (o João pode trocar)
- Sem fine-tuning; treino por camadas, com chat de teste e aprendizado com correção aprovada pelo dono.
- Reativação é voltar a falar depois de 30 dias parado; sem retorno é 24 h sem resposta.
- Módulo novo `atendente/` ao lado do antigo, sem apagar o antigo nesta entrega.
- Nomes e formato dos modelos prontos ficam para quem constrói, usando como base o que a LAVI já tem em `conhecimento-lavinia.ts`.

Não verificado
- Nada foi executado. A leitura do código mostra os riscos, não prova que aconteceram. Os pontos A e D precisam de reprodução no staging.

## Pendências

- Passagens para pessoa: contagem adiada, falta evento com data. `AgenteConversa` só guarda o estado atual (`estado`, `pausadaAte`, `motivoPausa`); nada marca quando a passagem aconteceu. Por isso `passagensParaPessoa` fica em 0 e não aparece na tela nem no resumo.
