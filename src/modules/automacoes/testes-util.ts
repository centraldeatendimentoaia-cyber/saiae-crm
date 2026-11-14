import { vi } from "vitest";
import type { Deps, RunRow, RunPatch, StepRow, Store, StatusPasso } from "./executor";
import type { Definicao } from "./tipos";
import { CLAIM_TTL_MS } from "./tipos";

/** Banco em memória com a mesma semântica de atomicidade do Prisma (claim e salvar condicionais). Só para testes. */
export function criarStoreMemoria(defs: Record<string, Definicao>) {
    const runs = new Map<string, RunRow & { claimedBy: string | null; claimExpiresAt: Date | null; failureClass?: string | null; lastError?: string | null; motivoFim?: string | null }>();
    const passos: (StepRow & { runId: string; output?: unknown; error?: string; failureClass?: string })[] = [];
    const falhas = { fecharPassoDone: false, salvarApos: -1 };
    let salvarN = 0;

    const store: Store = {
        async claimRun(id, holder, agora, ttl) {
            const r = runs.get(id);
            if (!r) return null;
            const livre = r.status === "pending" || (r.status === "waiting" && !!r.resumeAt && r.resumeAt <= agora) || (r.status === "running" && !!r.claimExpiresAt && r.claimExpiresAt < agora);
            if (!livre) return null;
            r.status = "running"; r.claimedBy = holder; r.claimExpiresAt = new Date(agora.getTime() + ttl);
            return structuredClone(r) as RunRow;
        },
        async salvar(id, holder, patch: RunPatch, agora) {
            const n = salvarN++;
            if (falhas.salvarApos === n) throw new Error("MORREU");
            const r = runs.get(id);
            if (!r || r.claimedBy !== holder || r.status !== "running") return false;
            Object.assign(r, structuredClone(patch));
            if (patch.status && patch.status !== "running") { r.claimedBy = null; r.claimExpiresAt = null; } else r.claimExpiresAt = new Date(agora.getTime() + CLAIM_TTL_MS);
            return true;
        },
        async ultimoPasso(id) {
            const p = passos.filter((x) => x.runId === id).sort((a, b) => b.seq - a.seq)[0];
            return p ? { id: p.id, seq: p.seq, nodeId: p.nodeId, type: p.type, status: p.status } : null;
        },
        async abrirPasso(runId, seq, nodeId, type, status: StatusPasso) {
            if (passos.some((p) => p.runId === runId && p.seq === seq)) return null;
            const p = { id: `p${passos.length}`, runId, seq, nodeId, type, status };
            passos.push(p);
            return { id: p.id, seq, nodeId, type, status };
        },
        async fecharPasso(id, patch) {
            if (falhas.fecharPassoDone && patch.status === "done") throw new Error("MORREU");
            Object.assign(passos.find((p) => p.id === id)!, patch);
        },
        async definicao(v) { return defs[v]; },
        async listarProntas(agora) {
            return [...runs.values()].filter((r) => r.status === "pending" || (r.status === "waiting" && !!r.resumeAt && r.resumeAt <= agora) || (r.status === "running" && !!r.claimExpiresAt && r.claimExpiresAt < agora)).map((r) => r.id);
        },
    };
    const criar = (id: string, defId: string, agora: Date, extra: Partial<RunRow> = {}) => {
        runs.set(id, {
            id, userId: "u1", sessionId: "loja", contactKey: "5561999990001@s.whatsapp.net", flowVersionId: defId, status: "pending",
            currentNodeId: defs[defId].start, context: { vars: {}, tentativas: {} }, stepCount: 0, resumeAt: null,
            deadlineAt: new Date(agora.getTime() + 7 * 24 * 3_600_000), claimedBy: null, claimExpiresAt: null, ...extra,
        });
    };
    return { store, runs, passos, falhas, criar };
}

export function criarDeps(opts: { agora: { t: number }; holder?: string; sendText?: ReturnType<typeof vi.fn>; freeText?: boolean; janela?: boolean; optout?: boolean; conversa?: { estado: string; pausadaAte: Date | null } | null; conectado?: boolean }): Deps & { sendText: ReturnType<typeof vi.fn>; etiquetar: ReturnType<typeof vi.fn>; transferirHumano: ReturnType<typeof vi.fn> } {
    const sendText = opts.sendText ?? vi.fn(async () => ({ messageId: "wamid.1" }));
    const provider = {
        name: "cloud-api", sessionId: "loja", capabilities: { freeTextAnytime: opts.freeText ?? true, templates: true },
        isConnected: () => opts.conectado ?? true,
        resolveRecipient: async (to: string) => to,
        sendText,
        sendTemplate: vi.fn(async () => ({ messageId: "wamid.t" })),
    } as never;
    return {
        holder: opts.holder ?? "A",
        agora: () => new Date(opts.agora.t),
        optedOut: async () => opts.optout ?? false,
        conversa: async () => (opts.conversa === undefined ? null : opts.conversa),
        provider: () => ({ ok: true, provider }),
        janelaAberta: async () => opts.janela ?? true,
        etiquetar: vi.fn(async () => {}),
        transferirHumano: vi.fn(async () => {}),
        sendText,
    };
}
