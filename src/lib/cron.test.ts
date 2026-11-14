import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Teste do agendador (src/lib/cron.ts), um dos pontos de envio do CRM.
 * Mantém os casos de caracterização (o que é enviado, quando pula, o que marca como SENT/FAILED) e cobre a
 * confiabilidade da Sprint 2: claim atômico, queda e recuperação, retentativa, resultado desconhecido,
 * recorrente atrasada. O banco é emulado em memória, com a mesma unicidade da tabela real; nenhum envio é real.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- linhas do banco emulado
type Row = Record<string, any>;

const h = vi.hoisted(() => {
    const state: { tick: null | (() => Promise<void>) } = { tick: null };
    return {
        state,
        schedule: vi.fn((_expr: string, fn: () => Promise<void>) => {
            state.tick = fn;
        }),
        db: { msgs: new Map<string, Row>(), attempts: new Map<string, Row>(), seq: 0 },
        socket: { sendMessage: vi.fn() },
        getInstance: vi.fn(),
        assertCanSend: vi.fn(),
        recordMessages: vi.fn(),
        isOptedOut: vi.fn(),
        onlyInteractedEnabled: vi.fn(),
        hasInteracted: vi.fn(),
        getSafeMode: vi.fn(),
        safeGate: vi.fn(),
        resolveMedia: vi.fn(),
    };
});

const { db } = h;
const key = (id: string, at: Date) => `${id}|${at.toISOString()}`;
const sameDate = (a: unknown, b: unknown) => a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
/** where mínimo do Prisma: igualdade, { lt }, { lte }, null. */
function matches(row: Row, where: Row = {}): boolean {
    return Object.entries(where).every(([k, v]) => {
        const x = row[k];
        if (v instanceof Date) return sameDate(x, v);
        if (v && typeof v === "object") {
            const o = v as { lt?: Date; lte?: Date };
            if (o.lt) return x.getTime() < o.lt.getTime();
            if (o.lte) return x.getTime() <= o.lte.getTime();
        }
        return x === v;
    });
}

const prismaMock = {
    notification: { create: vi.fn(async (...args: unknown[]) => ({ args })) },
    broadcastLog: { updateMany: vi.fn(async () => ({ count: 0 })) },
    scheduledMessage: {
        findMany: vi.fn(async ({ where }: { where: Row }) =>
            [...db.msgs.values()].filter((m) => m.status === where.status && m.sendAt.getTime() <= where.sendAt.lte.getTime()).map((m) => ({ ...m, session: { sessionId: "sessao-1", userId: "u1" } }))),
        updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
            const rows = [...db.msgs.values()].filter((m) => matches(m, where));
            rows.forEach((m) => Object.assign(m, data));
            return { count: rows.length };
        }),
        update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => Object.assign(db.msgs.get(where.id)!, data)),
    },
    scheduledMessageAttempt: {
        create: vi.fn(async ({ data }: { data: Row }) => {
            const k = key(data.scheduledMessageId, data.occurrenceAt);
            if (db.attempts.has(k)) throw Object.assign(new Error("unique"), { code: "P2002" });
            db.attempts.set(k, { id: `a${++db.seq}`, claimedAt: new Date(), finishedAt: null, failureClass: null, error: null, ...data });
            return {};
        }),
        createMany: vi.fn(async ({ data, skipDuplicates }: { data: Row[]; skipDuplicates?: boolean }) => {
            for (const d of data) {
                const k = key(d.scheduledMessageId, d.occurrenceAt);
                if (db.attempts.has(k)) {
                    if (skipDuplicates) continue;
                    throw Object.assign(new Error("unique"), { code: "P2002" });
                }
                db.attempts.set(k, { id: `a${++db.seq}`, claimedAt: new Date(), finishedAt: null, failureClass: null, error: null, ...d });
            }
            return { count: data.length };
        }),
        findUnique: vi.fn(async ({ where }: { where: { scheduledMessageId_occurrenceAt: { scheduledMessageId: string; occurrenceAt: Date } } }) => {
            const w = where.scheduledMessageId_occurrenceAt;
            return db.attempts.get(key(w.scheduledMessageId, w.occurrenceAt)) ?? null;
        }),
        findMany: vi.fn(async ({ where }: { where: Row }) => [...db.attempts.values()].filter((a) => matches(a, where))),
        updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
            const rows = [...db.attempts.values()].filter((a) => matches(a, where));
            rows.forEach((a) => Object.assign(a, data));
            return { count: rows.length };
        }),
        count: vi.fn(async ({ where }: { where: Row }) => [...db.attempts.values()].filter((a) => matches(a, where)).length),
    },
};

vi.mock("node-cron", () => ({ default: { schedule: h.schedule } }));
vi.mock("@/lib/prisma", () => ({ prisma: new Proxy({}, { get: (_t, k) => (prismaMock as Record<PropertyKey, unknown>)[k] }) }));
vi.mock("@/modules/whatsapp/manager", () => ({ waManager: { getInstance: h.getInstance } }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/job-lock", () => ({ withJobLock: (_n: string, _t: number, fn: () => Promise<unknown>) => fn(), registrarInstancia: vi.fn(), outrasInstanciasVivas: async () => 0 }));
vi.mock("@/lib/plans", () => ({ assertCanSend: h.assertCanSend, recordMessages: h.recordMessages }));
vi.mock("@/lib/optout", () => ({ isOptedOut: h.isOptedOut }));
vi.mock("@/lib/interaction", () => ({
    onlyInteractedEnabled: h.onlyInteractedEnabled,
    hasInteracted: h.hasInteracted,
    NO_INTERACTION_ERROR: "Sem conversa anterior (modo: só quem já interagiu)",
}));
vi.mock("@/lib/retention", () => ({ startRetention: vi.fn() }));
vi.mock("@/modules/agente-salao/followup", () => ({ startFollowUps: vi.fn() }));
vi.mock("@/modules/social/scheduler", () => ({ startSocialScheduler: vi.fn() }));
vi.mock("@/lib/media", () => ({ resolveMedia: h.resolveMedia }));
vi.mock("@/lib/personalize", () => ({ personalizeFor: vi.fn(async (_s: string, _to: string, text: string) => text) }));
vi.mock("@/lib/wa-jid", () => ({ resolveSendJid: vi.fn(async (_sock: unknown, jid: string) => jid) }));
vi.mock("@/lib/safe-mode", () => ({
    getSafeMode: h.getSafeMode,
    safeGate: h.safeGate,
    humanDelayMs: () => 0,
    batchPauseMs: () => 0,
}));

import { CloudApiError } from "@/modules/whatsapp/cloud/errors";
import { initScheduler, MAX_ATRASO_MS, CLAIM_EXPIRA_MS } from "./cron";

const JID = "5561999531848@s.whatsapp.net";
const NOW = new Date("2026-10-14T12:00:00Z"); // quarta, 09:00 em Brasília
const MIN = 60_000;

function addMsg(over: Row = {}) {
    const m: Row = { id: "m1", jid: JID, content: "Olá!", mediaUrl: null, mediaType: null, cronExpression: null, status: "PENDING", sendAt: new Date(NOW.getTime() - MIN), ...over };
    db.msgs.set(m.id, m);
    return m;
}
const attemptOf = (id: string) => [...db.attempts.values()].filter((a) => a.scheduledMessageId === id);

async function runTick(tick = h.state.tick!) {
    const p = tick();
    await vi.runAllTimersAsync();
    await p;
}

/** Outra instância do processo: módulo novo (running próprio), mesmo banco. */
async function novaInstancia() {
    vi.resetModules();
    const m = await import("./cron");
    h.state.tick = null;
    m.initScheduler();
    return h.state.tick!;
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    db.msgs.clear();
    db.attempts.clear();
    h.state.tick = null;
    h.schedule.mockClear();
    h.socket.sendMessage.mockReset().mockResolvedValue({});
    h.getInstance.mockReset().mockReturnValue({ socket: h.socket });
    h.assertCanSend.mockReset().mockResolvedValue(undefined);
    h.recordMessages.mockReset().mockResolvedValue(undefined);
    h.isOptedOut.mockReset().mockResolvedValue(false);
    h.onlyInteractedEnabled.mockReset().mockResolvedValue(false);
    h.hasInteracted.mockReset().mockResolvedValue(true);
    h.getSafeMode.mockReset().mockResolvedValue(null);
    h.safeGate.mockReset().mockReturnValue({ ok: true });
    h.resolveMedia.mockReset().mockResolvedValue(Buffer.from("x"));
    initScheduler();
});

afterEach(() => vi.useRealTimers());

describe("agendador (cron.ts): comportamento básico", () => {
    it("agenda a rodada a cada minuto", () => {
        expect(h.schedule).toHaveBeenCalledWith("* * * * *", expect.any(Function));
    });

    it("envia texto, registra o consumo e marca SENT (com a tentativa registrada)", async () => {
        addMsg();
        await runTick();
        expect(h.socket.sendMessage).toHaveBeenCalledWith(JID, { text: "Olá!" });
        expect(h.recordMessages).toHaveBeenCalledWith("u1", 1);
        expect(db.msgs.get("m1")!.status).toBe("SENT");
        expect(attemptOf("m1")).toMatchObject([{ status: "sent" }]);
    });

    it("sessão desconectada: não envia, mantém PENDING e não cria registro", async () => {
        h.getInstance.mockReturnValue(null);
        addMsg();
        await runTick();
        expect(h.socket.sendMessage).not.toHaveBeenCalled();
        expect(db.msgs.get("m1")!.status).toBe("PENDING");
        expect(attemptOf("m1")).toHaveLength(0);
    });

    it("descadastrado (respondeu SAIR): não envia, FAILED, motivo de política registrado", async () => {
        h.isOptedOut.mockResolvedValue(true);
        addMsg();
        await runTick();
        expect(h.socket.sendMessage).not.toHaveBeenCalled();
        expect(h.recordMessages).not.toHaveBeenCalled();
        expect(db.msgs.get("m1")!.status).toBe("FAILED");
        expect(attemptOf("m1")[0]).toMatchObject({ status: "failed", failureClass: "policy" });
        expect(attemptOf("m1")[0].error).toMatch(/Descadastrado/);
    });

    it("modo 'só quem já interagiu': quem nunca falou fica sem envio (FAILED, política)", async () => {
        h.onlyInteractedEnabled.mockResolvedValue(true);
        h.hasInteracted.mockResolvedValue(false);
        addMsg();
        await runTick();
        expect(h.socket.sendMessage).not.toHaveBeenCalled();
        expect(db.msgs.get("m1")!.status).toBe("FAILED");
        expect(attemptOf("m1")[0].failureClass).toBe("policy");
    });

    it("plano bloqueia: mensagem única vira FAILED sem enviar, com registro", async () => {
        h.assertCanSend.mockRejectedValue(new Error("Assinatura suspensa"));
        addMsg();
        await runTick();
        expect(h.socket.sendMessage).not.toHaveBeenCalled();
        expect(db.msgs.get("m1")!.status).toBe("FAILED");
        expect(attemptOf("m1")[0]).toMatchObject({ status: "failed", failureClass: "policy" });
    });

    it("plano bloqueia: recorrente avança para a próxima ocorrência, mas a ocorrência perdida fica REGISTRADA", async () => {
        h.assertCanSend.mockRejectedValue(new Error("Sem cota"));
        addMsg({ cronExpression: "0 9 * * *", sendAt: NOW }); // hoje 09:00 BRT
        await runTick();
        expect(h.socket.sendMessage).not.toHaveBeenCalled();
        const m = db.msgs.get("m1")!;
        expect(m.status).toBe("PENDING");
        expect(m.sendAt.toISOString()).toBe("2026-10-15T12:00:00.000Z");
        expect(attemptOf("m1")[0]).toMatchObject({ status: "failed", failureClass: "policy" });
        expect(attemptOf("m1")[0].error).toMatch(/Plano bloqueou/);
    });

    it("fora da janela do Modo Seguro: espera, sem enviar nem alterar", async () => {
        h.getSafeMode.mockResolvedValue({ delayMinSec: 10, delayMaxSec: 40, batchSize: 25, batchPauseMin: 3, startHour: 9, endHour: 19 });
        h.safeGate.mockReturnValue({ ok: false, resumeAt: new Date() });
        addMsg();
        await runTick();
        expect(h.socket.sendMessage).not.toHaveBeenCalled();
        expect(db.msgs.get("m1")!.status).toBe("PENDING");
        expect(attemptOf("m1")).toHaveLength(0);
    });

    it("recorrente enviada: reprograma sem marcar SENT", async () => {
        addMsg({ cronExpression: "0 9 * * *", sendAt: NOW });
        await runTick();
        expect(h.socket.sendMessage).toHaveBeenCalledTimes(1);
        const m = db.msgs.get("m1")!;
        expect(m.status).toBe("PENDING");
        expect(m.sendAt.toISOString()).toBe("2026-10-15T12:00:00.000Z");
        expect(attemptOf("m1")[0].status).toBe("sent");
    });

    it("mídia de imagem vai com a legenda personalizada", async () => {
        addMsg({ mediaUrl: "/media/foto.jpg", mediaType: "image" });
        await runTick();
        expect(h.socket.sendMessage).toHaveBeenCalledWith(JID, { caption: "Olá!", image: Buffer.from("x") });
    });

    it("sem mensagens pendentes: não faz nada", async () => {
        await runTick();
        expect(h.getInstance).not.toHaveBeenCalled();
    });
});

describe("concorrência: claim atômico", () => {
    it("duas instâncias na mesma rodada: UM envio só (mensagem única)", async () => {
        addMsg();
        const t1 = await novaInstancia();
        const t2 = await novaInstancia();
        await Promise.all([runTick(t1), runTick(t2)]);
        expect(h.socket.sendMessage).toHaveBeenCalledTimes(1);
        expect(db.msgs.get("m1")!.status).toBe("SENT");
        expect(attemptOf("m1")).toHaveLength(1);
    });

    it("duas instâncias na mesma rodada: UM envio só (recorrente) e a série avança uma vez", async () => {
        addMsg({ cronExpression: "0 9 * * *", sendAt: NOW });
        const t1 = await novaInstancia();
        const t2 = await novaInstancia();
        await Promise.all([runTick(t1), runTick(t2)]);
        expect(h.socket.sendMessage).toHaveBeenCalledTimes(1);
        expect(db.msgs.get("m1")!.sendAt.toISOString()).toBe("2026-10-15T12:00:00.000Z");
    });

    it("rodar de novo depois de enviar não reenvia", async () => {
        addMsg({ cronExpression: "0 9 * * *", sendAt: NOW });
        await runTick();
        await runTick();
        expect(h.socket.sendMessage).toHaveBeenCalledTimes(1);
    });
});

describe("queda e recuperação", () => {
    it("processo morreu entre reservar e enviar (mensagem única): reinício NÃO reenvia e deixa resultado desconhecido visível", async () => {
        addMsg();
        // estado deixado pelo processo que morreu: reserva criada, sem desfecho
        db.attempts.set(key("m1", db.msgs.get("m1")!.sendAt), { id: "a0", scheduledMessageId: "m1", occurrenceAt: db.msgs.get("m1")!.sendAt, status: "claimed", claimedAt: new Date(NOW.getTime() - 2 * MIN), failureClass: null, error: null, finishedAt: null });

        await runTick(); // reserva ainda recente: outra instância pode estar enviando; não mexe
        expect(h.socket.sendMessage).not.toHaveBeenCalled();
        expect(db.msgs.get("m1")!.status).toBe("PENDING");

        vi.setSystemTime(new Date(NOW.getTime() + CLAIM_EXPIRA_MS + MIN));
        await runTick(); // reserva vencida: processo morreu
        expect(h.socket.sendMessage).not.toHaveBeenCalled();
        expect(db.msgs.get("m1")!.status).toBe("FAILED");
        expect(attemptOf("m1")[0]).toMatchObject({ status: "unknown", failureClass: "unknown" });
        expect(attemptOf("m1")[0].error).toMatch(/NÃO foi reenviada/);
    });

    it("processo morreu no meio (recorrente): ocorrência fica unknown, série segue, próxima ocorrência sai sem duplicar nem perder", async () => {
        const m = addMsg({ cronExpression: "0 9 * * *", sendAt: NOW });
        // morreu logo depois de reservar, antes de avançar a série
        db.attempts.set(key("m1", NOW), { id: "a0", scheduledMessageId: "m1", occurrenceAt: NOW, status: "claimed", claimedAt: new Date(NOW.getTime() - 1 * MIN), failureClass: null, error: null, finishedAt: null });

        vi.setSystemTime(new Date(NOW.getTime() + CLAIM_EXPIRA_MS));
        await runTick();
        expect(h.socket.sendMessage).not.toHaveBeenCalled(); // não reenviou a ocorrência de hoje
        expect(attemptOf("m1").find((a) => a.occurrenceAt.getTime() === NOW.getTime())!.status).toBe("unknown");
        expect(m.sendAt.toISOString()).toBe("2026-10-15T12:00:00.000Z"); // série avançou

        vi.setSystemTime(new Date("2026-10-15T12:00:30Z")); // chegou a ocorrência de amanhã
        await runTick();
        expect(h.socket.sendMessage).toHaveBeenCalledTimes(1);
        expect(attemptOf("m1").find((a) => a.occurrenceAt.toISOString() === "2026-10-15T12:00:00.000Z")!.status).toBe("sent");
    });

    it("erro de banco depois do envio (consumo): não vira reenvio nem falha", async () => {
        h.recordMessages.mockRejectedValue(new Error("db fora"));
        addMsg();
        await runTick();
        expect(db.msgs.get("m1")!.status).toBe("SENT");
        await runTick();
        expect(h.socket.sendMessage).toHaveBeenCalledTimes(1);
    });
});

describe("retentativa e resultado desconhecido", () => {
    it("falha transitória: retenta com espera crescente, sem duplicar, e termina quando passa", async () => {
        h.socket.sendMessage.mockRejectedValueOnce(new CloudApiError("rate_limit", "boom")).mockResolvedValue({});
        addMsg();
        await runTick();
        const m = db.msgs.get("m1")!;
        expect(m.status).toBe("PENDING");
        expect(m.sendAt.getTime()).toBeGreaterThan(NOW.getTime());
        expect(attemptOf("m1")).toMatchObject([{ status: "failed", failureClass: "transient" }]);

        await runTick(); // ainda dentro da espera
        expect(h.socket.sendMessage).toHaveBeenCalledTimes(1);

        vi.setSystemTime(new Date(m.sendAt.getTime() + 1000));
        await runTick();
        expect(h.socket.sendMessage).toHaveBeenCalledTimes(2); // 1 falha + 1 sucesso
        expect(m.status).toBe("SENT");

        vi.setSystemTime(new Date(NOW.getTime() + 60 * MIN));
        await runTick();
        expect(h.socket.sendMessage).toHaveBeenCalledTimes(2);
    });

    it("falha transitória persistente: para depois de poucas tentativas e fica FAILED", async () => {
        h.socket.sendMessage.mockRejectedValue(new CloudApiError("rate_limit", "boom"));
        addMsg();
        for (let i = 0; i < 8; i++) {
            await runTick();
            vi.setSystemTime(new Date(Date.now() + 11 * MIN));
        }
        expect(db.msgs.get("m1")!.status).toBe("FAILED");
        expect(h.socket.sendMessage).toHaveBeenCalledTimes(4);
    });

    it("resultado desconhecido (tempo esgotado): NÃO reenvia nunca, marca unknown e FAILED visível", async () => {
        h.socket.sendMessage.mockRejectedValue(new Error("Timed Out"));
        addMsg();
        await runTick();
        expect(attemptOf("m1")[0]).toMatchObject({ status: "unknown", failureClass: "unknown" });
        expect(db.msgs.get("m1")!.status).toBe("FAILED");
        for (let i = 0; i < 5; i++) {
            vi.setSystemTime(new Date(Date.now() + 11 * MIN));
            await runTick();
        }
        expect(h.socket.sendMessage).toHaveBeenCalledTimes(1);
    });

    it("erro comum DEPOIS de chamar o provedor pode ter saído: unknown, não reenvia, avisa o dono sem telefone", async () => {
        h.socket.sendMessage.mockRejectedValue(new Error("falha 5561999531848@s.whatsapp.net sem padrão"));
        addMsg();
        await runTick();
        expect(attemptOf("m1")[0]).toMatchObject({ status: "unknown", failureClass: "unknown" });
        expect(attemptOf("m1")[0].error).not.toMatch(/\d{8,}|@s\.whatsapp\.net/);
        expect(db.msgs.get("m1")!.status).toBe("FAILED");
        expect(prismaMock.notification.create).toHaveBeenCalledTimes(1);
        expect(prismaMock.notification.create.mock.calls[0][0]).toMatchObject({ data: { userId: "u1" } });
    });

    it("erro ANTES de chamar o provedor (mídia não carregou) segue transitório e retenta", async () => {
        h.resolveMedia.mockRejectedValue(new Error("falha ao ler arquivo"));
        addMsg({ mediaUrl: "x.png", mediaType: "image" });
        await runTick();
        expect(attemptOf("m1")[0]).toMatchObject({ failureClass: "transient" });
        expect(db.msgs.get("m1")!.status).toBe("PENDING");
        expect(h.socket.sendMessage).not.toHaveBeenCalled();
    });

    it("falha permanente (número sem WhatsApp): sem retentativa", async () => {
        h.socket.sendMessage.mockRejectedValue(new Error("Número não possui WhatsApp"));
        addMsg();
        await runTick();
        expect(db.msgs.get("m1")!.status).toBe("FAILED");
        expect(attemptOf("m1")[0].failureClass).toBe("permanent");
        expect(h.socket.sendMessage).toHaveBeenCalledTimes(1);
    });

    it("a falha de uma mensagem não interrompe a rodada", async () => {
        h.socket.sendMessage.mockRejectedValueOnce(new Error("Número não possui WhatsApp")).mockResolvedValue({});
        addMsg({ id: "a" });
        addMsg({ id: "b" });
        await runTick();
        expect(db.msgs.get("a")!.status).toBe("FAILED");
        expect(db.msgs.get("b")!.status).toBe("SENT");
    });

    it("recorrente que falha: a falha fica registrada e a série avança (não some em silêncio)", async () => {
        h.socket.sendMessage.mockRejectedValue(new Error("Número não possui WhatsApp"));
        addMsg({ cronExpression: "0 9 * * *", sendAt: NOW });
        await runTick();
        expect(attemptOf("m1")).toMatchObject([{ status: "failed", failureClass: "permanent" }]);
        expect(db.msgs.get("m1")!.sendAt.toISOString()).toBe("2026-10-15T12:00:00.000Z");
        expect(db.msgs.get("m1")!.status).toBe("PENDING");
    });

    it("recorrente com resultado desconhecido: marca unknown, não reenvia, série avança", async () => {
        h.socket.sendMessage.mockRejectedValue(new Error("Connection Closed"));
        addMsg({ cronExpression: "0 9 * * *", sendAt: NOW });
        await runTick();
        await runTick();
        expect(h.socket.sendMessage).toHaveBeenCalledTimes(1);
        expect(attemptOf("m1")[0].status).toBe("unknown");
    });
});

describe("falha ao gravar o desfecho DEPOIS do envio", () => {
    it("finish('sent') falha: não cai no catch do tick, não vira FAILED nem reenvia; a reserva vira unknown depois", async () => {
        addMsg();
        const orig = prismaMock.scheduledMessageAttempt.updateMany.getMockImplementation()!;
        prismaMock.scheduledMessageAttempt.updateMany.mockImplementationOnce(async () => { throw new Error("banco caiu"); });
        await runTick();
        expect(h.socket.sendMessage).toHaveBeenCalledTimes(1);
        expect(db.msgs.get("m1")!.status).toBe("SENT");
        expect(attemptOf("m1")[0].status).toBe("claimed");
        prismaMock.scheduledMessageAttempt.updateMany.mockImplementation(orig);
        vi.setSystemTime(new Date(NOW.getTime() + CLAIM_EXPIRA_MS + MIN));
        await runTick();
        expect(h.socket.sendMessage).toHaveBeenCalledTimes(1);
        expect(attemptOf("m1")[0].status).toBe("unknown");
    });

    it("update de SENT falha: não propaga, não marca FAILED, não reenvia", async () => {
        addMsg();
        prismaMock.scheduledMessage.update.mockImplementationOnce(async () => { throw new Error("banco caiu"); });
        await runTick();
        expect(h.socket.sendMessage).toHaveBeenCalledTimes(1);
        expect(db.msgs.get("m1")!.status).toBe("PENDING"); // sem desfecho gravado; a reserva "claimed" impede novo envio
        await runTick();
        expect(h.socket.sendMessage).toHaveBeenCalledTimes(1);
    });
});

describe("recorrente atrasada", () => {
    it("cron parado por mais de 8 h numa recorrência por minuto (acima do limite de 500 ocorrências): não quebra, envia no máximo uma vez e a série segue no futuro", async () => {
        addMsg({ cronExpression: "* * * * *", sendAt: new Date(NOW.getTime() - 9 * 3_600_000) });
        await runTick();
        expect(h.socket.sendMessage.mock.calls.length).toBeLessThanOrEqual(1);
        expect(db.msgs.get("m1")!.status).toBe("PENDING");
        expect(db.msgs.get("m1")!.sendAt.getTime()).toBeGreaterThan(NOW.getTime());
    });

    it("servidor ficou parado 3 dias, dentro do prazo da última: envia UMA vez (a mais recente) e registra as outras como perdidas", async () => {
        addMsg({ cronExpression: "0 9 * * *", sendAt: new Date("2026-10-11T12:00:00Z") });
        await runTick();
        expect(h.socket.sendMessage).toHaveBeenCalledTimes(1);
        const missed = attemptOf("m1").filter((a) => a.status === "missed");
        expect(missed.map((a) => a.occurrenceAt.toISOString()).sort()).toEqual(["2026-10-11T12:00:00.000Z", "2026-10-12T12:00:00.000Z", "2026-10-13T12:00:00.000Z"]);
        expect(missed[0].error).toMatch(/substituída/);
        expect(attemptOf("m1").find((a) => a.status === "sent")!.occurrenceAt.toISOString()).toBe("2026-10-14T12:00:00.000Z");
        expect(db.msgs.get("m1")!.sendAt.toISOString()).toBe("2026-10-15T12:00:00.000Z");
    });

    it("última ocorrência também fora do prazo: nada é enviado, todas registradas como perdidas com motivo e a série segue", async () => {
        vi.setSystemTime(new Date(NOW.getTime() + MAX_ATRASO_MS + MIN));
        addMsg({ cronExpression: "0 9 * * *", sendAt: new Date("2026-10-13T12:00:00Z") });
        await runTick();
        expect(h.socket.sendMessage).not.toHaveBeenCalled();
        const rows = attemptOf("m1");
        expect(rows).toHaveLength(2);
        expect(rows.every((a) => a.status === "missed" && /fora do prazo/.test(a.error))).toBe(true);
        expect(db.msgs.get("m1")!.status).toBe("PENDING");
        expect(db.msgs.get("m1")!.sendAt.toISOString()).toBe("2026-10-15T12:00:00.000Z");
    });

    it("mensagem única vencida há muito (sessão ficou desconectada dias): não sai texto velho; FAILED com motivo", async () => {
        addMsg({ sendAt: new Date(NOW.getTime() - MAX_ATRASO_MS - MIN) });
        await runTick();
        expect(h.socket.sendMessage).not.toHaveBeenCalled();
        expect(db.msgs.get("m1")!.status).toBe("FAILED");
        expect(attemptOf("m1")[0]).toMatchObject({ status: "missed" });
        expect(prismaMock.notification.create).toHaveBeenCalledTimes(1); // uma por ocorrência perdida
        await runTick();
        expect(prismaMock.notification.create).toHaveBeenCalledTimes(1);
    });

    it("expressão de recorrência inválida: FAILED visível, sem repetir erro todo minuto", async () => {
        addMsg({ cronExpression: "isso não é cron" });
        await runTick();
        expect(db.msgs.get("m1")!.status).toBe("FAILED");
        expect(attemptOf("m1")[0]).toMatchObject({ status: "failed", failureClass: "permanent" });
        expect(h.socket.sendMessage).not.toHaveBeenCalled();
    });
});
