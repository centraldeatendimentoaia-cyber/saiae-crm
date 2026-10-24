# Avisos de pedido pelo WhatsApp da barraca (Baileys)

Cada restaurante conecta o próprio WhatsApp por QR Code e o cliente recebe avisos automáticos do pedido: recebido, pronto, saiu para entrega, entregue e cancelado. Envio por texto livre, pelo Baileys (sem API oficial e sem template), um número por restaurante.

## ATENÇÃO: o deploy cria tabelas

O CRM roda `prisma db push` em todo start. Publicar esta mudança cria duas tabelas novas no banco de produção: `BarracaSessao` e `AvisoPedido`. Nenhuma tabela existente é alterada (`User`, `Session` e `OptOut` ficam como estão).

## Ordem de deploy

1. Configurar no Railway (nunca em chat): `COMANDA_WHATSAPP_SEGREDO` (mínimo de 16 caracteres; aceita lista separada por vírgula para rotação) e `COMANDA_WHATSAPP_EVENTO_URL` (`{SUPABASE}/functions/v1/crm-evento-sessao`).
2. Publicar o CRM.
3. Do lado do Sai aê: aplicar as migrations, configurar `WHATSAPP_CONEXAO_SEGREDO` (mesmo valor de `COMANDA_WHATSAPP_SEGREDO`) e `CRM_WHATSAPP_CONEXAO_URL`, publicar as funções e o app.
4. A tela nasce escondida para todas as lojas, menos a de teste.

Variáveis opcionais: `COMANDA_WHATSAPP_USUARIO_EMAIL` (e-mail da conta técnica; padrão `avisos-whatsapp@integracao.saiae.com.br`).

## Como funciona

- **Vínculo**: `BarracaSessao (barracaId, sessionId único)`. A rota de conexão cria a sessão da barraca na primeira chamada `iniciar` (id `saiae-<barraca_id>`). Uma barraca pode ter várias sessões; a integração opera na mais antiga.
- **Conta do CRM**: toda `Session` pertence a um `User`. As sessões das barracas pertencem a uma única conta técnica, criada pelo próprio CRM na primeira conexão, com senha aleatória descartada (ninguém entra nela).
- **Rota** `POST /api/integracao/comanda/v1/whatsapp-conexao`: HMAC com `COMANDA_WHATSAPP_SEGREDO`, janela de 5 minutos, 401 idêntico para qualquer falha de autenticação, 503 sem segredo, 422 fora do contrato (nunca ecoa valores), 429 acima de 90 chamadas por minuto por barraca. Ações: `iniciar`, `status`, `desconectar`, `historico`. Resposta: `{ estado, qr, numero, avisos? }`. O `qr` só sai em `aguardando_qr`.
- **Registro**: a rota de eventos grava o aviso como `pendente` em `AvisoPedido` ANTES de responder 2xx. Se o banco falhar, responde 503 e a Comanda reenvia. A restrição única `(barraca, pedido, tipo)` garante um único aviso por pedido e tipo, inclusive depois de reiniciar o CRM.
- **Worker** (`aviso-worker.ts`, liga no boot e a cada registro): reserva o aviso, aplica validade, tetos e descadastro, envia, e tenta de novo com espera crescente (5 s, 30 s, 120 s; depois `falhou`).
- **Dados pessoais**: o telefone e o texto ficam em `payload` só enquanto o aviso está pendente. Em qualquer estado final o campo é apagado. O log e os motivos usam só códigos fixos.
- **Barraca sem WhatsApp próprio** continua pelo caminho antigo (template da Cloud API, só com `COMANDA_NOTIFY_TEMPLATES=on`). Barraca com vínculo nunca usa a Cloud API.

## Gatilhos

| Aviso | Evento |
|---|---|
| recebido | `order.created` |
| pronto | `order.ready` |
| saiu_entrega | `order.out_for_delivery` |
| entregue | `order.status_changed` com `data.status = "entregue"` |
| cancelado | `order.cancelled` |

"Entregue" não avisa se o pedido nasceu entregue (a linha `entregue` é gravada como `pulado_nao_aplica`, motivo `nasceu_entregue`) e não repete em correção de status (chave única).

## Textos

O evento traz, de forma aditiva, `data.avisos = { recebido|pronto|saiu_entrega|entregue|cancelado: { ativo, texto } }`. Ausente = ativo com o texto padrão (`aviso-textos.ts`). `ativo: false` não envia e registra `pulado_nao_aplica` (motivo `desativado_pela_loja`). Variáveis: `{nome}` (primeiro nome), `{senha}` (`#42`), `{barraca}`. Variável sem valor some junto do espaço. Máximo de 500 caracteres.

## Estados do aviso

`pendente`, `enviado`, `falhou`, `pulado_sem_telefone`, `pulado_optout`, `pulado_desconectado`, e um estado novo, `pulado_nao_aplica` (aviso desligado pela loja ou pedido que nasceu entregue). O Sai aê deve tratar estado desconhecido como genérico.

Motivos (códigos fixos): `sessao_desconectada`, `validade_expirada`, `teto_por_minuto`, `teto_diario`, `erro_envio`, `numero_sem_whatsapp`, `sem_dados_para_envio`, `desativado_pela_loja`, `nasceu_entregue`.

## Validade

Constantes em `VALIDADE_MS` (`aviso-textos.ts`): recebido 30 min; pronto, saiu_entrega e entregue 15 min; cancelado 60 min, contados do `occurred_at`. Com a sessão desconectada o aviso espera e, passada a validade, vira `pulado_desconectado`. Nada acumula fila para sair horas depois.

## Ritmo e tetos

Pausa aleatória de 1 a 3 s antes de cada envio, mais o anti-spam do Baileys (ligado por padrão em todas as sessões: 5 mensagens por 10 s, atraso de 1 a 3 s ao estourar). Teto por barraca: 6 por minuto e 100 por dia na primeira semana do vínculo; depois 20 por minuto e 800 por dia (`TETO_POR_MINUTO`, `TETO_POR_DIA`). Estourou: espera até a validade; depois `falhou` (`teto_por_minuto` ou `teto_diario`).

## Aviso de queda para o Sai aê

`instance.ts` chama `avisarEstadoSessao` (`sessao-evento.ts`): `conectado` ao abrir a conexão e `caiu` ao deslogar ou esgotar as reconexões. POST em `COMANDA_WHATSAPP_EVENTO_URL`, mesma assinatura do contrato, corpo `{ barraca_id, estado, occurred_at, request_id }`, três tentativas, melhor esforço. Sessão sem vínculo com barraca é ignorada. O estado `desconectado` do contrato não é enviado hoje: uma parada explícita (`stop`) também ocorre em reinício e geraria ruído.

## Descadastro

"SAIR" (e "PARAR") grava em `OptOut` por sessão, e a sessão é da barraca. O worker confere `isOptedOut(sessionId, telefone)` antes de cada envio. Descadastrado não recebe nenhum aviso.

## Limites conhecidos e riscos

- O Baileys não é oficial: há risco de bloqueio do número. Os tetos e o ritmo reduzem o risco, não o eliminam.
- O CRM roda tudo em um único processo; a capacidade com muitas lojas não foi medida.
- Só sessões com credenciais (`AuthState`) são recarregadas no boot.
- Idempotência por `id` do evento e ordem por `sequence` continuam em memória; a idempotência do AVISO é em banco.
- Não há indicador "digitando" antes do envio (o provedor Baileys não expõe presença).
- Sessão apagada pelo painel do CRM deixa o vínculo `BarracaSessao` órfão (sem relação Prisma, de propósito, para não alterar `Session`). Uma nova chamada `iniciar` não recria a sessão: apague a linha de `BarracaSessao` também.
- Fases seguintes (bot que anota pedido, disparos) não estão incluídas.
