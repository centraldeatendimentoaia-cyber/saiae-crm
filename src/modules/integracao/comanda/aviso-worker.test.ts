import { Prisma } from "@prisma/client";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/optout", () => ({ isOptedOut: vi.fn() }));
vi.mock("@/modules/whatsapp/manager", () => ({ waManager: { getInstance: vi.fn() } }));
vi.mock("@/modules/whatsapp/provider", () => ({ getProvider: vi.fn() }));

import { CloudApiError } from "@/modules/whatsapp/cloud/errors";
import { ENVIANDO_EXPIRA_MS, ESPERA_RETENTATIVA_MS, MAX_TENTATIVAS, RESERVA_MS, TETO_POR_DIA, TETO_POR_MINUTO, processarPendentes, type LinhaAviso, type WorkerDeps } from "./aviso-worker";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AGORA = Date.parse("2026-10-23T12:10:00Z");
const MIN = 60_000;

interface Linha extends LinhaAviso {
    estado: string;
    proximaTentativaEm: Date;
    enviadoEm: Date | null;
    atualizadoEm: Date;
}

type Where = { id?: string; estado?: string; proximaTentativaEm?: Date | { lte: Date }; atualizadoEm?: { lt: Date } };
const casa = (l: Linha, w: Where) =>
    (w.id === undefined || l.id === w.id) &&
    (w.estado === undefined || l.estado === w.estado) &&
    (w.proximaTentativaEm === undefined ||
        (w.proximaTentativaEm instanceof Date ? l.proximaTentativaEm.getTime() === w.proximaTentativaEm.getTime() : l.proximaTentativaEm.getTime() <= w.proximaTentativaEm.lte.getTime())) &&
    (w.atualizadoEm === undefined || l.atualizadoEm.getTime() < w.atualizadoEm.lt.getTime());

/** Relógio e banco em memória compartilháveis entre dois "workers" (duas instâncias). */
const relogio = { t: AGORA };

function cenario(opts: { linhas?: Partial<Linha>[]; conectadas?: string[]; vinculoCriadoHaDias?: number; enviadosNoMinuto?: number; enviadosNoDia?: number } = {}) {
    const linhas: Linha[] = (opts.linhas ?? [{}]).map((l, i) => ({
        id: `l${i}`, barracaId: A, pedidoId: `p${i}`, tipo: "pronto", tentativas: 0, motivo: null,
        ocorridoEm: new Date(AGORA - MIN), estado: "pendente", proximaTentativaEm: new Date(AGORA - 1000), enviadoEm: null, atualizadoEm: new Date(AGORA),
        payload: { telefone: "5561999990001", texto: "Olá!" }, ...l,
    }));
    const criadoEm = new Date(AGORA - (opts.vinculoCriadoHaDias ?? 30) * 24 * 60 * MIN);
    const sessoes: Record<string, string> = { [A]: "sessao-A", [B]: "sessao-B" };
    const db = {
        avisoPedido: {
            findMany: async () => linhas.filter((l) => l.estado === "pendente" && l.proximaTentativaEm.getTime() <= relogio.t).map((l) => ({ ...l })),
            updateMany: async (a: { where: Where; data: Partial<Linha> }) => {
                const alvo = linhas.filter((x) => casa(x, a.where));
                alvo.forEach((l) => Object.assign(l, a.data, { atualizadoEm: new Date(relogio.t) }));
                return { count: alvo.length };
            },
            update: async (a: { where: { id: string }; data: Partial<Linha> }) => Object.assign(linhas.find((x) => x.id === a.where.id)!, a.data),
            count: async (a: { where: { enviadoEm: { gte: Date } } }) => {
                const desde = a.where.enviadoEm.gte.getTime();
                return desde >= AGORA - 60_000 ? (opts.enviadosNoMinuto ?? 0) : (opts.enviadosNoDia ?? 0);
            },
        },
        barracaSessao: { findFirst: async (a: { where: { barracaId: string } }) => (sessoes[a.where.barracaId] ? { sessionId: sessoes[a.where.barracaId], createdAt: criadoEm } : null) },
    };
    const provider = { isConnected: () => true, resolveRecipient: vi.fn(async (t: string) => t), sendText: vi.fn(async () => ({ messageId: "m" })) };
    const providers: Record<string, typeof provider> = { "sessao-A": provider, "sessao-B": { ...provider, sendText: vi.fn(async () => ({ messageId: "m" })) } };
    const deps: Partial<WorkerDeps> = {
        db: db as never,
        now: () => relogio.t,
        sleep: async () => {},
        random: () => 0,
        estaConectada: (s) => (opts.conectadas ?? ["sessao-A", "sessao-B"]).includes(s),
        getProvider: (s) => providers[s] as never,
        isOptedOut: vi.fn(async () => false),
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
    return { linhas, deps, provider, providers };
}

beforeEach(() => {
    vi.clearAllMocks();
    relogio.t = AGORA;
});

describe("processarPendentes", () => {
    it("envia o texto, marca enviado e apaga o payload (sem dado pessoal no histórico)", async () => {
        const { linhas, deps, provider } = cenario();
        expect(await processarPendentes(deps)).toBe(1);
        expect(provider.resolveRecipient).toHaveBeenCalledWith("5561999990001@s.whatsapp.net");
        expect(provider.sendText).toHaveBeenCalledWith("5561999990001@s.whatsapp.net", "Olá!");
        expect(linhas[0]).toMatchObject({ estado: "enviado", payload: Prisma.DbNull, tentativas: 1 });
        expect(linhas[0].enviadoEm).toBeInstanceOf(Date);
    });

    it("não reenvia o que já foi enviado", async () => {
        const { deps, provider } = cenario();
        await processarPendentes(deps);
        await processarPendentes(deps);
        expect(provider.sendText).toHaveBeenCalledTimes(1);
    });

    it("sessão desconectada: espera, sem enviar nem gastar tentativa", async () => {
        const { linhas, deps, provider } = cenario({ conectadas: [] });
        await processarPendentes(deps);
        expect(provider.sendText).not.toHaveBeenCalled();
        expect(linhas[0]).toMatchObject({ estado: "pendente", motivo: "sessao_desconectada", tentativas: 0 });
        expect(linhas[0].proximaTentativaEm.getTime()).toBeGreaterThan(AGORA);
    });

    it.each([
        ["recebido", 31 * MIN, "pulado_desconectado"],
        ["pronto", 16 * MIN, "pulado_desconectado"],
        ["saiu_entrega", 16 * MIN, "pulado_desconectado"],
        ["entregue", 16 * MIN, "pulado_desconectado"],
        ["cancelado", 61 * MIN, "pulado_desconectado"],
    ])("%s desconectado há %i ms além da validade vira %s e perde o payload", async (tipo, idade, estado) => {
        const { linhas, deps, provider } = cenario({ conectadas: [], linhas: [{ tipo, ocorridoEm: new Date(AGORA - idade) }] });
        await processarPendentes(deps);
        expect(linhas[0]).toMatchObject({ estado, motivo: "validade_expirada", payload: Prisma.DbNull });
        expect(provider.sendText).not.toHaveBeenCalled();
    });

    it("dentro da validade ainda espera (cancelado de 40 min, recebido de 20 min)", async () => {
        const { linhas, deps } = cenario({ conectadas: [], linhas: [{ tipo: "cancelado", ocorridoEm: new Date(AGORA - 40 * MIN) }, { tipo: "recebido", ocorridoEm: new Date(AGORA - 20 * MIN) }] });
        await processarPendentes(deps);
        expect(linhas.map((l) => l.estado)).toEqual(["pendente", "pendente"]);
    });

    it("sem vínculo com sessão trata como desconectada", async () => {
        const { linhas, deps } = cenario({ linhas: [{ barracaId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }] });
        await processarPendentes(deps);
        expect(linhas[0]).toMatchObject({ estado: "pendente", motivo: "sessao_desconectada" });
    });

    it("cliente descadastrado: pulado_optout, nada enviado", async () => {
        const { linhas, deps, provider } = cenario();
        (deps.isOptedOut as ReturnType<typeof vi.fn>).mockResolvedValue(true);
        await processarPendentes(deps);
        expect(linhas[0]).toMatchObject({ estado: "pulado_optout", payload: Prisma.DbNull });
        expect(provider.sendText).not.toHaveBeenCalled();
        expect(deps.isOptedOut).toHaveBeenCalledWith("sessao-A", "5561999990001@s.whatsapp.net");
    });

    it("falha do Baileys: tenta de novo com espera crescente e termina em falhou", async () => {
        const { linhas, deps, provider } = cenario();
        provider.sendText.mockRejectedValue(new Error("socket caiu +5561999990001"));
        for (let i = 1; i < MAX_TENTATIVAS; i++) {
            linhas[0].proximaTentativaEm = new Date(AGORA - 1);
            await processarPendentes(deps);
            expect(linhas[0]).toMatchObject({ estado: "pendente", tentativas: i, motivo: "erro_envio" });
            expect(linhas[0].proximaTentativaEm.getTime()).toBe(AGORA + ESPERA_RETENTATIVA_MS[i - 1]);
        }
        linhas[0].proximaTentativaEm = new Date(AGORA - 1);
        await processarPendentes(deps);
        expect(linhas[0]).toMatchObject({ estado: "falhou", motivo: "erro_envio", payload: Prisma.DbNull, tentativas: MAX_TENTATIVAS });
    });

    it("número sem WhatsApp: falhou na hora, sem retentar", async () => {
        const { linhas, deps, provider } = cenario();
        provider.resolveRecipient.mockRejectedValue(new Error("Número não possui WhatsApp"));
        await processarPendentes(deps);
        expect(linhas[0]).toMatchObject({ estado: "falhou", motivo: "numero_sem_whatsapp", payload: Prisma.DbNull });
        expect(provider.sendText).not.toHaveBeenCalled();
    });

    it("o motivo e o log nunca contêm telefone nem texto do erro", async () => {
        const { linhas, deps, provider } = cenario();
        provider.sendText.mockRejectedValue(new Error("falha com 5561999990001"));
        await processarPendentes(deps);
        expect(linhas[0].motivo).toBe("erro_envio");
        expect(JSON.stringify((deps.logger as unknown as { warn: ReturnType<typeof vi.fn> }).warn.mock.calls)).not.toContain("5561999990001");
    });

    it("isolamento: o aviso da barraca A sai pela sessão A, nunca pela B", async () => {
        const { deps, provider, providers } = cenario({ linhas: [{ barracaId: A }, { barracaId: B, pedidoId: "pB" }] });
        await processarPendentes(deps);
        expect(provider.sendText).toHaveBeenCalledTimes(1);
        expect(providers["sessao-B"].sendText).toHaveBeenCalledTimes(1);
        expect(deps.isOptedOut).toHaveBeenCalledWith("sessao-A", expect.any(String));
        expect(deps.isOptedOut).toHaveBeenCalledWith("sessao-B", expect.any(String));
    });

    it("teto por minuto: número novo tem teto menor; estourou, espera", async () => {
        const novo = cenario({ vinculoCriadoHaDias: 2, enviadosNoMinuto: TETO_POR_MINUTO.novo });
        await processarPendentes(novo.deps);
        expect(novo.provider.sendText).not.toHaveBeenCalled();
        expect(novo.linhas[0]).toMatchObject({ estado: "pendente", motivo: "teto_por_minuto" });

        const velho = cenario({ vinculoCriadoHaDias: 60, enviadosNoMinuto: TETO_POR_MINUTO.novo });
        await processarPendentes(velho.deps);
        expect(velho.provider.sendText).toHaveBeenCalledTimes(1);
    });

    it("teto por dia: estourado e fora da validade vira falhou/teto_diario", async () => {
        const { linhas, deps, provider } = cenario({ vinculoCriadoHaDias: 2, enviadosNoDia: TETO_POR_DIA.novo, linhas: [{ ocorridoEm: new Date(AGORA - 20 * MIN) }] });
        await processarPendentes(deps);
        expect(provider.sendText).not.toHaveBeenCalled();
        expect(linhas[0]).toMatchObject({ estado: "falhou", motivo: "teto_diario", payload: Prisma.DbNull });
    });

    it("duas execuções ao mesmo tempo não enviam o mesmo aviso duas vezes (reserva)", async () => {
        const { deps, provider } = cenario();
        await Promise.all([processarPendentes(deps), processarPendentes(deps)]);
        expect(provider.sendText).toHaveBeenCalledTimes(1);
    });

    it("aviso sem payload válido não trava a fila", async () => {
        const { linhas, deps } = cenario({ linhas: [{ payload: Prisma.DbNull }] });
        await processarPendentes(deps);
        expect(linhas[0]).toMatchObject({ estado: "falhou", motivo: "sem_dados_para_envio" });
    });

    it("falha transitória da Cloud (limite de taxa): retenta; sem duplicar", async () => {
        const { linhas, deps, provider } = cenario();
        provider.sendText.mockRejectedValueOnce(new CloudApiError("rate_limit", "Meta: limite")).mockResolvedValue({ messageId: "w" });
        await processarPendentes(deps);
        expect(linhas[0]).toMatchObject({ estado: "pendente", motivo: "erro_envio", tentativas: 1 });
        relogio.t = linhas[0].proximaTentativaEm.getTime() + 1;
        await processarPendentes(deps);
        expect(linhas[0]).toMatchObject({ estado: "enviado" });
        expect(provider.sendText).toHaveBeenCalledTimes(2); // 1 falha + 1 sucesso, nenhuma mensagem em dobro
        relogio.t += 10 * MIN;
        await processarPendentes(deps);
        expect(provider.sendText).toHaveBeenCalledTimes(2);
    });

    it("resultado desconhecido (tempo esgotado depois de chamar o provedor): NÃO reenvia, fica falhou/resultado_desconhecido", async () => {
        const { linhas, deps, provider } = cenario();
        provider.sendText.mockRejectedValue(new Error("Timed Out"));
        await processarPendentes(deps);
        expect(linhas[0]).toMatchObject({ estado: "falhou", motivo: "resultado_desconhecido", payload: Prisma.DbNull });
        relogio.t += 30 * MIN;
        await processarPendentes(deps);
        expect(provider.sendText).toHaveBeenCalledTimes(1);
    });

    it("Cloud API: erro de rede no envio é resultado desconhecido; janela de 24 h é política e também não retenta", async () => {
        const rede = cenario();
        rede.provider.sendText.mockRejectedValue(new CloudApiError("network", "Tempo esgotado"));
        await processarPendentes(rede.deps);
        expect(rede.linhas[0]).toMatchObject({ estado: "falhou", motivo: "resultado_desconhecido" });

        const janela = cenario();
        janela.provider.sendText.mockRejectedValue(new CloudApiError("window_closed", "Janela fechada"));
        await processarPendentes(janela.deps);
        expect(janela.linhas[0]).toMatchObject({ estado: "falhou", motivo: "bloqueio_de_politica" });
    });

    it("tempo esgotado ANTES de enviar (resolver o número) ainda não é resultado desconhecido: retenta", async () => {
        const { linhas, deps, provider } = cenario();
        provider.resolveRecipient.mockRejectedValue(new Error("Timed Out"));
        await processarPendentes(deps);
        expect(provider.sendText).not.toHaveBeenCalled();
        expect(linhas[0]).toMatchObject({ estado: "pendente", motivo: "erro_envio", tentativas: 1 });
    });

    it("queda entre marcar 'enviando' e confirmar: no reinício o aviso NÃO é reenviado e fica visível como resultado desconhecido", async () => {
        const { linhas, deps, provider } = cenario({ linhas: [{ estado: "enviando", proximaTentativaEm: new Date(AGORA + RESERVA_MS) }] });
        linhas[0].atualizadoEm = new Date(AGORA - ENVIANDO_EXPIRA_MS - 1);
        await processarPendentes(deps);
        expect(provider.sendText).not.toHaveBeenCalled();
        expect(linhas[0]).toMatchObject({ estado: "falhou", motivo: "resultado_desconhecido" });
    });

    it("'enviando' recente (outro worker agora no envio) não é mexido", async () => {
        const { linhas, deps, provider } = cenario({ linhas: [{ estado: "enviando" }] });
        await processarPendentes(deps);
        expect(provider.sendText).not.toHaveBeenCalled();
        expect(linhas[0].estado).toBe("enviando");
    });

    it("queda depois da reserva e antes do envio: a reserva vence e o aviso é enviado uma vez (nada saiu)", async () => {
        const { linhas, deps, provider } = cenario({ linhas: [{ proximaTentativaEm: new Date(AGORA + RESERVA_MS) }] });
        await processarPendentes(deps);
        expect(provider.sendText).not.toHaveBeenCalled(); // ainda reservado por quem caiu
        relogio.t = AGORA + RESERVA_MS + 1;
        await processarPendentes(deps);
        expect(provider.sendText).toHaveBeenCalledTimes(1);
        expect(linhas[0].estado).toBe("enviado");
    });

    it("lote longo: a reserva é tomada na hora de cada aviso (relógio atual), então a de um aviso não vence no meio do lote", async () => {
        const { linhas, deps, provider } = cenario({ linhas: [{}, { pedidoId: "p2" }, { pedidoId: "p3" }] });
        (deps as { sleep: (ms: number) => Promise<void> }).sleep = async () => { relogio.t += 50_000; }; // cada envio demora 50 s
        const lotes = await processarPendentes(deps);
        expect(lotes).toBe(3);
        // o terceiro aviso foi reservado ~100 s depois do início do ciclo, com reserva completa a partir de então
        expect(provider.sendText).toHaveBeenCalledTimes(3);
        expect(linhas.every((l) => l.estado === "enviado")).toBe(true);
    });

    it("segundo worker não finaliza um aviso cuja reserva foi tomada por outro (perda de posse)", async () => {
        const { linhas, deps, provider } = cenario();
        provider.sendText.mockImplementation(async () => {
            // enquanto este worker envia, outra instância reassume o aviso
            linhas[0].estado = "pendente";
            linhas[0].proximaTentativaEm = new Date(relogio.t + 999);
            return { messageId: "m" };
        });
        await processarPendentes(deps);
        expect(linhas[0]).toMatchObject({ estado: "pendente" }); // não sobrescreveu
    });
});
