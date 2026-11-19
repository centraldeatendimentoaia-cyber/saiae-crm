# Sprint 5: desenho do motor de automações

Escopo: motor com fluxos em JSON. Sem editor visual, sem gatilho real de webhook/Meta (só início manual/interno). ChatbotX foi usado apenas como referência de padrões (rascunho separado de publicado, versão do formato, códigos de validação centralizados); nenhum código foi copiado.

## 1. Modelo de dados (somente tabelas novas, sem FK para `User`/`Session`)

| Tabela | Papel |
|---|---|
| `AutomationFlow` | Fluxo do usuário numa sessão. Guarda o **rascunho** (`draft`, editável) e `publishedVersionId`. |
| `AutomationFlowVersion` | Versão **publicada e imutável** (`@@unique [flowId, version]`). Mudar o fluxo = publicar outra versão. Execuções antigas seguem na versão com que começaram. |
| `AutomationRun` | Execução de uma versão para um contato. Guarda estado, nó atual, `context` (variáveis e contadores de tentativa), `stepCount`, `resumeAt`, reserva (`claimedBy`, `claimExpiresAt`), `deadlineAt`, falha (`failureClass`, `lastError`) e `motivoFim`. Unicidade `[flowVersionId, contactKey, dedupeKey]`. |
| `AutomationStep` | Histórico por passo (`@@unique [runId, seq]`). Para envio, a linha `claimed` é gravada **antes** de chamar o provedor. |

Escopo: `userId` em fluxo e execução; `sessionId` = `Session.sessionId` (mesma chave de `AgenteConversa`, `OptOut`, `getProvider`); `contactKey` = JID do contato. Tabelas existentes reaproveitadas, sem alteração: `AgenteConversa` (estado humano/IA), `OptOut`, `Label`/`ChatLabel`, `JobLock`.

## 2. Formato JSON do fluxo (`schemaVersion: 1`)

```json
{ "schemaVersion": 1, "start": "oi",
  "nodes": {
    "oi":   { "type": "texto", "text": "Oi {{nome}}!", "next": "esp" },
    "esp":  { "type": "espera", "ms": 600000, "next": "cond" },
    "cond": { "type": "condicao", "expr": { "op": "eq", "a": { "var": "plano" }, "b": "pro" }, "then": "tag", "else": "fim" },
    "tag":  { "type": "etiqueta", "nome": "VIP", "next": "fim" },
    "fim":  { "type": "fim" } } }
```

Nós: `texto`, `template`, `condicao`, `espera`, `etiqueta`, `variavel`, `transferencia_humana`, `fim`. Sem `next` o fluxo conclui.

- **Condição**: objeto com operadores fixos (`eq ne gt gte lt lte contains startsWith in exists and or not`), operandos literais ou `{ "var": nome }`. Sem texto executável, sem `eval`/`Function`. Variáveis só por propriedade própria (nomes `__proto__`, `constructor`, `prototype` recusados). Comparação sem coerção de tipo.
- **Interpolação**: só `{{nome}}`, passada única (valor inserido não é interpolado de novo), ausente vira texto vazio.
- Futuras versões do formato incrementam `schemaVersion`; o validador recusa o que não conhece.

## 3. Máquina de estados da execução

```
pending ──claim──> running ──espera──> waiting ──(resumeAt vencido, claim)──> running
                      │  └─ falha transitória (backoff) ─> waiting
                      ├─> completed   (fim, sem next, transferência humana)
                      ├─> failed      (permanent | policy | unknown | transient esgotado | limite | timeout)
                      └─> cancelled   (manual | humano_assumiu | optout)
running com claimExpiresAt vencido = abandonada (processo caiu): outra instância reivindica e reconcilia.
```

Estados finais não voltam. `salvar` só grava se `claimedBy` é nosso e o status é `running`: cancelamento externo vence e o executor para (`perdida`).

## 4. Reaproveitamento

- **Claim atômico**: `UPDATE ... WHERE id AND (pending OR waiting vencida OR running abandonada)`, vale se `count === 1` (mesmo padrão de `ScheduledMessageAttempt` do Sprint 2). Duas instâncias nunca executam a mesma execução.
- **JobLock** (`withJobLock("cron:automacoes")`): só evita varreduras duplicadas; a garantia real é o claim.
- **send-failure** (`classifySendFailure`, `backoffMs`, `MAX_ATTEMPTS`, `maskPersonalData`): transitória retenta com backoff e esgota; `permanent`/`policy` falham sem retentar; `unknown` falha e **nunca reenvia**.
- **Retomada sem duplicar**: passo `claimed` sobrando (processo caiu depois de chamar o provedor) vira `unknown` e a execução falha com `failureClass = unknown`. Passo `done` sem avanço (caiu depois de confirmar) avança sem reenviar.
- **quemPodeEnviar**: chamado ao retomar e antes de TODO envio e da transferência. Humano com pausa válida = execução `cancelled` (`humano_assumiu`). Opt-out (`isOptedOut`) = `cancelled` (`optout`).
- **Cloud**: sessão pelo `cloud-sessao` (`numeroDeEnvioPertence` para o número de envio) e `getProvider`; sem provedor/desconectado = transitória. Provedor sem texto livre (Cloud) exige janela de 24 h aberta (`Contact.lastInboundAt`), senão `policy` sem retentar; `template` sai a qualquer hora. Provedor sem `sendTemplate` = permanente.

## 5. Proteções

| Proteção | Valor |
|---|---|
| Execuções ativas por contato e fluxo | 1 |
| Deduplicação | `[versão, contato, dedupeKey]`; sem chave, janela de 1 h |
| Passos por execução | 200 (inclui retentativas) |
| Nós por fluxo | 100 |
| Profundidade de condição aninhada | 8 (não há subfluxos, então "profundidade" = aninhamento de condição) |
| Tempo total por execução | 7 dias (`deadlineAt`) |
| Espera | 1 s a 30 dias |
| Variáveis por execução | 100 |

**Validador de grafo** (ao publicar): forma e tipos de nó, `start` e destinos existentes, nós órfãos, ciclo sem nó de espera, limites. Loop com espera é aceito; o limite de passos é a rede de segurança.

## 6. Superfície

Serviço `src/modules/automacoes/servico.ts` (tudo escopado por `userId`) e API mínima autenticada: `GET/POST /api/automacoes`, `POST /api/automacoes/[id]/publicar`, `POST /api/automacoes/[id]/iniciar` (gatilho manual), `GET /api/automacoes/runs/[runId]`, `POST /api/automacoes/runs/[runId]/cancelar`. Worker em `worker.ts`, ligado só com `AUTOMACOES_ATIVAS=true`.
