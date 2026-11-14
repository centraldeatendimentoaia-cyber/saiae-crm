import { errorMessage } from "@/lib/errors";
import { MAX_ATTEMPTS, backoffMs, classifySendFailure, maskPersonalData, type FailureClass } from "@/lib/send-failure";
import { quemPodeEnviar } from "@/modules/atendimento-comum/precedencia";
import type { WhatsAppProvider } from "@/modules/whatsapp/provider/types";
import { avaliar, interpolar } from "./expressao";
import {
    CLAIM_TTL_MS, MAX_CLAIMS_SEM_PROGRESSO, MAX_PASSOS, PAUSA_HUMANO_MS,
    type Contexto, type Definicao, type MotivoCancelamento, type No, type StatusRun,
} from "./tipos";

/** Linha de execução como o executor a enxerga (a tabela AutomationRun). */
export interface RunRow {
    id: string;
    userId: string;
    sessionId: string;
    contactKey: string;
    flowVersionId: string;
    status: StatusRun;
    currentNodeId: string | null;
    context: Contexto;
    stepCount: number;
    /** Reivindicações desde o último salvamento bem-sucedido (a própria reivindicação já soma 1). */
    claimsSemProgresso: number;
    resumeAt: Date | null;
    deadlineAt: Date;
}
export type RunPatch = Partial<Pick<RunRow, "status" | "currentNodeId" | "context" | "stepCount" | "resumeAt">> & {
    failureClass?: FailureClass | null;
    lastError?: string | null;
    motivoFim?: string | null;
    finishedAt?: Date | null;
};
export type StatusPasso = "claimed" | "done" | "failed" | "unknown";
export interface StepRow { id: string; seq: number; nodeId: string; type: string; status: StatusPasso }

/** Persistência. A implementação real (Prisma) garante a atomicidade de `claimRun` e de `salvar`. */
export interface Store {
    /** Reivindica a execução de forma atômica (pending, waiting vencida ou running abandonada). Null = outra instância a tem. */
    claimRun(runId: string, holder: string, agora: Date, ttlMs: number): Promise<RunRow | null>;
    /** Grava só se ainda somos o dono e a execução segue "running" (cancelamento externo vence). False = perdemos a execução. */
    salvar(runId: string, holder: string, patch: RunPatch, agora: Date): Promise<boolean>;
    ultimoPasso(runId: string): Promise<StepRow | null>;
    /**
     * Null se (runId, seq) já existe. Com `posse` (reserva de envio) a criação é atômica com a checagem de que a execução
     * segue "running" e ainda é nossa: cancelada ou tomada por outra instância = null, e o envio não pode acontecer.
     */
    abrirPasso(runId: string, seq: number, nodeId: string, type: string, status: StatusPasso, posse?: { holder: string; agora: Date }): Promise<StepRow | null>;
    fecharPasso(stepId: string, patch: { status: StatusPasso; output?: unknown; error?: string; failureClass?: FailureClass }): Promise<void>;
    definicao(flowVersionId: string): Promise<Definicao>;
    listarProntas(agora: Date, limite: number): Promise<string[]>;
}

export type ProvedorResolvido =
    | { ok: true; provider: WhatsAppProvider }
    | { ok: false; permanente: boolean; motivo: string };

/** Tudo o que toca o mundo de fora (provedor, conversa, opt-out, relógio), injetável para teste. */
export interface Deps {
    holder: string;
    agora(): Date;
    optedOut(sessionId: string, contactKey: string): Promise<boolean>;
    /** O usuário da execução ainda é dono da sessão (ou tem SessionAccess)? Falso = sessão apagada, recriada por outro ou acesso revogado. */
    temAcesso(userId: string, sessionId: string): Promise<boolean>;
    /** Modo Seguro (só Baileys): fora do horário devolve quando a janela abre. Ausente = sem restrição. */
    gateEnvio?(sessionId: string, provider: WhatsAppProvider): Promise<{ ok: true } | { ok: false; resumeAt: Date }>;
    /** Espaçamento humano entre envios (só Baileys), chamado por `processarProntas` entre execuções. */
    espacar?(sessionId: string, provider: WhatsAppProvider): Promise<void>;
    /** Mesmas políticas dos outros envios: plano/cota e "só quem já interagiu". `transitoria` = falha de infraestrutura (tenta de novo); senão é política e encerra. */
    politicaEnvio(sessionId: string, destino: string): Promise<{ ok: true } | { ok: false; transitoria: boolean; motivo: string }>;
    /** Registra 1 envio no consumo do plano. Chamado só depois de a mensagem sair; falha aqui nunca vira reenvio. */
    registrarConsumo(sessionId: string): Promise<void>;
    conversa(sessionId: string, contactKey: string): Promise<{ estado: string; pausadaAte: Date | null } | null>;
    /** Provedor da sessão (Cloud: sessão resolvida por `cloud-sessao`, nunca "a primeira da lista"). */
    provider(sessionId: string): ProvedorResolvido;
    /** Cliente falou nas últimas 24 h? Só consultado quando o provedor não envia texto livre a qualquer hora. */
    janelaAberta(sessionId: string, contactKey: string): Promise<boolean>;
    etiquetar(sessionId: string, contactKey: string, nome: string): Promise<void>;
    transferirHumano(sessionId: string, contactKey: string, ate: Date): Promise<void>;
}

export type ResultadoRun = "nao_reivindicada" | "perdida" | "waiting" | "completed" | "failed" | "cancelled";

const AVISO_INTERROMPIDA = "Processo interrompido entre reservar e confirmar o envio. Pode ou não ter saído; NÃO foi reenviada. Confira na conversa.";
const ehEnvio = (n: No) => n.type === "texto" || n.type === "template";
const curto = (e: unknown) => maskPersonalData(errorMessage(e, "erro")).slice(0, 500);

function contextoDe(c: unknown): Contexto {
    const x = (c ?? {}) as Partial<Contexto>;
    return { vars: { ...(x.vars ?? {}) }, tentativas: { ...(x.tentativas ?? {}) } };
}

/**
 * Executa UMA execução até ela esperar, terminar ou falhar. Seguro para duas instâncias chamarem ao mesmo tempo
 * (só uma reivindica) e para o processo cair em qualquer ponto: o estado está sempre no banco, e envio sem desfecho
 * vira "unknown" e nunca é reenviado.
 */
export async function executarRun(runId: string, store: Store, deps: Deps, info: { enviou?: { sessionId: string; provider: WhatsAppProvider } } = {}): Promise<ResultadoRun> {
    const run = await store.claimRun(runId, deps.holder, deps.agora(), CLAIM_TTL_MS);
    if (!run) return "nao_reivindicada";
    const ctx = contextoDe(run.context);

    /** Grava e espelha no objeto local. False = a execução não é mais nossa (cancelada, ou a trava foi tomada). */
    const salvar = async (patch: RunPatch): Promise<boolean> => {
        const ok = await store.salvar(run.id, deps.holder, patch, deps.agora());
        if (ok) Object.assign(run, patch);
        return ok;
    };
    const terminar = async (status: "completed" | "failed" | "cancelled", extra: RunPatch = {}): Promise<ResultadoRun> =>
        (await salvar({ status, finishedAt: deps.agora(), resumeAt: null, ...extra })) ? status : "perdida";
    const falhar = (failureClass: FailureClass, lastError: string) => terminar("failed", { failureClass, lastError });
    const cancelar = (motivo: MotivoCancelamento) => terminar("cancelled", { motivoFim: motivo });

    // Execução envenenada: várias reivindicações seguidas sem conseguir salvar nada (banco/definição quebrados) param de rodar.
    if (run.claimsSemProgresso > MAX_CLAIMS_SEM_PROGRESSO) return falhar("permanent", `execução travada: mais de ${MAX_CLAIMS_SEM_PROGRESSO} reivindicações seguidas sem progresso`);

    const def = await store.definicao(run.flowVersionId);
    const ultimo = await store.ultimoPasso(run.id);
    let seq = ultimo?.seq ?? 0;

    // Retomada após queda: reserva de envio sem desfecho = pode ou não ter saído. Nunca reenvia.
    if (ultimo?.status === "claimed") {
        await store.fecharPasso(ultimo.id, { status: "unknown", failureClass: "unknown", error: AVISO_INTERROMPIDA });
        return falhar("unknown", AVISO_INTERROMPIDA);
    }
    // Passo já "unknown" (envio com resultado desconhecido, mas a gravação do fim da execução falhou): segue impedindo o reenvio.
    if (ultimo?.status === "unknown") return falhar("unknown", AVISO_INTERROMPIDA);
    // Envio concluído mas a execução não chegou a avançar: avança sem reenviar.
    let envioJaFeito = !!ultimo && ultimo.status === "done" && ultimo.nodeId === run.currentNodeId && (ultimo.type === "texto" || ultimo.type === "template");

    const registrar = (no: string, tipo: string, status: StatusPasso, output?: unknown) =>
        store.abrirPasso(run.id, ++seq, no, tipo, status).then(async (p) => {
            if (p && output !== undefined && status !== "claimed") await store.fecharPasso(p.id, { status, output });
            return p;
        });

    const falhaDeNo = async (cls: FailureClass, erro: unknown, noId: string): Promise<ResultadoRun> => {
        if (cls !== "transient") return falhar(cls, curto(erro));
        const n = (ctx.tentativas[noId] = (ctx.tentativas[noId] ?? 0) + 1);
        if (n >= MAX_ATTEMPTS) return falhar("transient", `${curto(erro)} (tentativas esgotadas)`);
        const ok = await salvar({ status: "waiting", resumeAt: new Date(deps.agora().getTime() + backoffMs(n)), context: ctx, stepCount: run.stepCount + 1 });
        return ok ? "waiting" : "perdida";
    };

    for (let primeira = true; ; primeira = false) {
        if (run.stepCount >= MAX_PASSOS) return falhar("permanent", "limite de passos por execução atingido");
        if (deps.agora() > run.deadlineAt) return falhar("permanent", "tempo total da execução excedido");
        const noId = run.currentNodeId;
        const no = noId && Object.prototype.hasOwnProperty.call(def.nodes, noId) ? def.nodes[noId] : undefined;
        if (!noId || !no) return falhar("permanent", "nó atual inexistente na versão do fluxo");

        // Cancelamento automático: ao retomar e antes de CADA envio (humano assumiu ou contato saiu).
        if (!envioJaFeito && (primeira || ehEnvio(no) || no.type === "transferencia_humana")) {
            if (!(await deps.temAcesso(run.userId, run.sessionId))) return cancelar("sessao_invalida");
            if (await deps.optedOut(run.sessionId, run.contactKey)) return cancelar("optout");
            const conv = (await deps.conversa(run.sessionId, run.contactKey)) ?? { estado: "ia", pausadaAte: null };
            if (!quemPodeEnviar(conv, deps.agora()).pode) return cancelar("humano_assumiu");
        }

        /** Registra o passo como feito e anda para `next` (ou conclui se não há). Null = segue o laço. */
        const avancar = async (next: string | undefined, saida?: unknown): Promise<ResultadoRun | null> => {
            const p = await registrar(noId, no.type, "done", saida ?? {});
            if (!p) return "perdida";
            if (!next) return terminar("completed");
            ctx.tentativas = {}; // tentativas valem por nó: ao avançar, o próximo começa do zero
            return (await salvar({ currentNodeId: next, stepCount: run.stepCount + 1, context: ctx })) ? null : "perdida";
        };
        let fim: ResultadoRun | null;

        switch (no.type) {
            case "variavel":
                if (Object.keys(ctx.vars).length >= 100) return falhar("permanent", "variáveis demais na execução");
                ctx.vars[no.nome] = interpolar(no.valor, ctx.vars);
                fim = await avancar(no.next);
                break;
            case "condicao": {
                let r: boolean;
                try { r = avaliar(no.expr, ctx.vars); } catch (e) { return falhar("permanent", curto(e)); }
                fim = await avancar(r ? no.then : no.else, { resultado: r });
                break;
            }
            case "etiqueta":
                try { await deps.etiquetar(run.sessionId, run.contactKey, no.nome); } catch (e) { return falhaDeNo("transient", e, noId); }
                fim = await avancar(no.next);
                break;
            case "espera": {
                const p = await registrar(noId, no.type, "done", { ms: no.ms });
                if (!p) return "perdida";
                if (!no.next) return terminar("completed");
                ctx.tentativas = {};
                const ok = await salvar({ status: "waiting", currentNodeId: no.next, resumeAt: new Date(deps.agora().getTime() + no.ms), stepCount: run.stepCount + 1, context: ctx });
                return ok ? "waiting" : "perdida";
            }
            case "transferencia_humana":
                try { await deps.transferirHumano(run.sessionId, run.contactKey, new Date(deps.agora().getTime() + PAUSA_HUMANO_MS)); } catch (e) { return falhaDeNo("transient", e, noId); }
                if (!(await registrar(noId, no.type, "done", {}))) return "perdida";
                return terminar("completed", { motivoFim: "transferencia_humana" });
            case "fim":
                if (!(await registrar(noId, no.type, "done", {}))) return "perdida";
                return terminar("completed");
            case "texto":
            case "template": {
                if (envioJaFeito) { envioJaFeito = false; fim = await avancar(no.next, { jaEnviado: true }); break; }
                const pr = deps.provider(run.sessionId);
                if (!pr.ok) return pr.permanente ? falhar("permanent", pr.motivo) : falhaDeNo("transient", pr.motivo, noId);
                const provider = pr.provider;
                if (!provider.isConnected()) return falhaDeNo("transient", "sessão desconectada", noId);
                // Modo Seguro (Baileys): fora do horário a execução espera a janela abrir, sem gastar tentativa.
                const gate = deps.gateEnvio ? await deps.gateEnvio(run.sessionId, provider) : { ok: true as const };
                if (!gate.ok) return (await salvar({ status: "waiting", resumeAt: gate.resumeAt, context: ctx })) ? "waiting" : "perdida";

                let enviar: () => Promise<{ messageId: string | null }>;
                // Política da Cloud: texto livre só com a janela de 24 h aberta; fora dela, só template.
                if (no.type === "texto") {
                    if (!provider.capabilities.freeTextAnytime && !(await deps.janelaAberta(run.sessionId, run.contactKey)))
                        return falhar("policy", "janela de atendimento (24 h) fechada: texto livre bloqueado, use template");
                    const texto = interpolar(no.text, ctx.vars).trim();
                    if (!texto) return falhar("permanent", "texto vazio após interpolar variáveis");
                    enviar = () => provider.sendText(destino!, texto);
                } else {
                    if (!provider.sendTemplate) return falhar("permanent", "provedor da sessão não suporta template");
                    const params = (no.params ?? []).map((p) => interpolar(p, ctx.vars));
                    enviar = () => provider.sendTemplate!(destino!, { name: no.name, languageCode: no.languageCode, bodyParameters: params });
                }

                let destino: string | undefined;
                try { destino = await provider.resolveRecipient(run.contactKey); } catch (e) { return falhaDeNo(classifySendFailure(e), e, noId); }

                // Mesmas políticas dos outros envios (plano/cota e "só quem já interagiu"), antes de reservar.
                const pol = await deps.politicaEnvio(run.sessionId, destino!).catch((e): { ok: false; transitoria: boolean; motivo: string } => ({ ok: false, transitoria: true, motivo: curto(e) }));
                if (!pol.ok) return pol.transitoria ? falhaDeNo("transient", pol.motivo, noId) : falhar("policy", pol.motivo);

                // Reserva ANTES de chamar o provedor: se o processo cair daqui até fechar o passo, a retomada vê "claimed".
                // A reserva é atômica com "execução ainda running e nossa": cancelamento anterior a ela impede o envio.
                const passo = await store.abrirPasso(run.id, ++seq, noId, no.type, "claimed", { holder: deps.holder, agora: deps.agora() });
                if (!passo) return "perdida";
                let enviada: { messageId: string | null };
                try {
                    enviada = await enviar();
                } catch (e) {
                    const cls = classifySendFailure(e, { sendAttempted: true });
                    await store.fecharPasso(passo.id, { status: cls === "unknown" ? "unknown" : "failed", error: curto(e), failureClass: cls });
                    return falhaDeNo(cls, e, noId);
                }
                // Fora do try: falha do banco aqui NÃO é falha de envio (a mensagem saiu); o passo fica "claimed" e a retomada o marca "unknown".
                await store.fecharPasso(passo.id, { status: "done", output: { messageId: enviada.messageId } });
                info.enviou = { sessionId: run.sessionId, provider };
                await deps.registrarConsumo(run.sessionId).catch(() => {}); // falha contábil não é falha de envio: nunca reenvia
                ctx.tentativas = {};
                if (!(await salvar({ currentNodeId: no.next ?? noId, stepCount: run.stepCount + 1, context: ctx }))) return "perdida";
                if (!no.next) return terminar("completed");
                fim = null;
                break;
            }
        }
        if (fim) return fim;
    }
}

/** Uma rodada do worker: executa as execuções prontas (pendentes, esperas vencidas, abandonadas). */
export async function processarProntas(store: Store, deps: Deps, limite = 50, orcamentoMs = Infinity): Promise<Record<ResultadoRun, number>> {
    const total: Record<ResultadoRun, number> = { nao_reivindicada: 0, perdida: 0, waiting: 0, completed: 0, failed: 0, cancelled: 0 };
    const inicio = Date.now();
    for (const id of await store.listarProntas(deps.agora(), limite)) {
        if (Date.now() - inicio > orcamentoMs) break; // o espaçamento entre envios alonga a rodada: o resto fica para a próxima
        const info: { enviou?: { sessionId: string; provider: WhatsAppProvider } } = {};
        try { total[await executarRun(id, store, deps, info)]++; } catch { total.perdida++; /* fica abandonada e a próxima rodada a retoma */ }
        if (info.enviou && deps.espacar) await deps.espacar(info.enviou.sessionId, info.enviou.provider).catch(() => {});
    }
    return total;
}
