import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/modules/whatsapp/manager", () => ({ waManager: { getInstance: vi.fn() } }));

import { executarAcaoConexao, garantirUsuarioTecnico, type ConexaoDeps, type InstanciaLike } from "./whatsapp-conexao";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const pedido = (acao: "iniciar" | "status" | "desconectar" | "historico", barraca = A) => ({ barraca_id: barraca, acao, request_id: crypto.randomUUID() }) as const;

function cenario(inicial: { vinculos?: Record<string, string>; instancias?: Record<string, InstanciaLike> } = {}) {
    const vinculos: Record<string, string> = { ...(inicial.vinculos ?? {}) };
    const instancias: Record<string, InstanciaLike> = { ...(inicial.instancias ?? {}) };
    const usuarios: string[] = [];
    const sessoesCriadas: string[] = [];
    const aviso = [{ pedidoId: "p1", tipo: "pronto", estado: "enviado", motivo: null, atualizadoEm: new Date("2026-10-23T12:00:00Z") }];
    const db = {
        user: {
            findUnique: async () => (usuarios.length ? { id: "u1" } : null),
            create: async (a: unknown) => { usuarios.push(JSON.stringify(a)); return { id: "u1" }; },
        },
        session: { findUnique: async () => null, update: vi.fn(async () => ({})) },
        authState: { deleteMany: vi.fn(async () => ({})) },
        barracaSessao: {
            findFirst: async (a: { where: { barracaId: string } }) => (vinculos[a.where.barracaId] ? { sessionId: vinculos[a.where.barracaId], createdAt: new Date() } : null),
            create: async (a: { data: { barracaId: string; sessionId: string } }) => { vinculos[a.data.barracaId] = a.data.sessionId; return {}; },
        },
        avisoPedido: { findMany: vi.fn(async (a: { where: { barracaId: string } }) => (a.where.barracaId === A ? aviso : [])) },
        $transaction: vi.fn(async () => []),
    };
    const manager = {
        getInstance: (s: string) => instancias[s],
        removeInstance: vi.fn((s: string) => { delete instancias[s]; }),
        createSession: vi.fn(async (_u: string, _n: string, s: string) => { sessoesCriadas.push(s); }),
        startSession: vi.fn(async (s: string) => { instancias[s] = { status: "SCAN_QR", qr: "2@qr-bruto", socket: null }; }),
    };
    const deps: Partial<ConexaoDeps> = { db: db as never, manager: manager as never, env: {}, sleep: async () => {} };
    return { deps, db, manager, vinculos, instancias, usuarios, sessoesCriadas };
}

describe("status", () => {
    it("barraca sem vínculo: sem_sessao", async () => {
        expect(await executarAcaoConexao(pedido("status"), cenario().deps)).toEqual({ estado: "sem_sessao", qr: null, numero: null });
    });
    it("lendo o QR: aguardando_qr com o texto bruto", async () => {
        const c = cenario({ vinculos: { [A]: "sA" }, instancias: { sA: { status: "SCAN_QR", qr: "2@abc", socket: null } } });
        expect(await executarAcaoConexao(pedido("status"), c.deps)).toEqual({ estado: "aguardando_qr", qr: "2@abc", numero: null });
    });
    it("conectado: número só com dígitos, sem QR", async () => {
        const c = cenario({ vinculos: { [A]: "sA" }, instancias: { sA: { status: "CONNECTED", qr: "velho", socket: { user: { id: "5561999990001:12@s.whatsapp.net" }, logout: async () => {} } } } });
        expect(await executarAcaoConexao(pedido("status"), c.deps)).toEqual({ estado: "conectado", qr: null, numero: "5561999990001" });
    });
    it("vinculado mas sem instância (parada ou caiu): desconectado", async () => {
        const c = cenario({ vinculos: { [A]: "sA" } });
        expect(await executarAcaoConexao(pedido("status"), c.deps)).toEqual({ estado: "desconectado", qr: null, numero: null });
    });
});

describe("iniciar", () => {
    it("primeira vez: cria a conta técnica, a sessão e o vínculo, inicia e devolve o QR", async () => {
        const c = cenario();
        const r = await executarAcaoConexao(pedido("iniciar"), c.deps);
        expect(r).toEqual({ estado: "aguardando_qr", qr: "2@qr-bruto", numero: null });
        expect(c.usuarios).toHaveLength(1);
        expect(c.sessoesCriadas).toEqual([`saiae-${A}`]);
        expect(c.vinculos[A]).toBe(`saiae-${A}`);
    });
    it("a conta técnica tem senha aleatória (nunca a do e-mail) e não é criada duas vezes", async () => {
        const c = cenario();
        await garantirUsuarioTecnico({ db: c.db as never, env: {} });
        await garantirUsuarioTecnico({ db: c.db as never, env: {} });
        expect(c.usuarios).toHaveLength(1);
        expect(c.usuarios[0]).toContain("avisos-whatsapp@integracao.saiae.com.br");
        expect(c.usuarios[0]).toMatch(/\$2[aby]\$/);
    });
    it("já existe instância (lendo o QR ou conectada): não inicia outra", async () => {
        const c = cenario({ vinculos: { [A]: "sA" }, instancias: { sA: { status: "SCAN_QR", qr: "2@abc", socket: null } } });
        await executarAcaoConexao(pedido("iniciar"), c.deps);
        expect(c.manager.startSession).not.toHaveBeenCalled();
        expect(c.manager.createSession).not.toHaveBeenCalled();
    });
    it("repetir iniciar não cria sessão nova", async () => {
        const c = cenario();
        await executarAcaoConexao(pedido("iniciar"), c.deps);
        await executarAcaoConexao(pedido("iniciar"), c.deps);
        expect(c.manager.createSession).toHaveBeenCalledTimes(1);
        expect(c.manager.startSession).toHaveBeenCalledTimes(1);
    });
});

describe("desconectar", () => {
    it("com socket ativo: faz logout e tira a instância da memória", async () => {
        const logout = vi.fn(async () => {});
        const c = cenario({ vinculos: { [A]: "sA" }, instancias: { sA: { status: "CONNECTED", qr: null, socket: { logout } } } });
        const r = await executarAcaoConexao(pedido("desconectar"), c.deps);
        expect(logout).toHaveBeenCalled();
        expect(r.estado).toBe("desconectado");
        expect(c.manager.removeInstance).toHaveBeenCalledWith("sA");
    });
    it("sem socket: apaga as credenciais no banco", async () => {
        const c = cenario({ vinculos: { [A]: "sA" } });
        await executarAcaoConexao(pedido("desconectar"), c.deps);
        expect(c.db.$transaction).toHaveBeenCalled();
    });
    it("barraca sem vínculo: sem_sessao, nada é tocado", async () => {
        const c = cenario();
        expect((await executarAcaoConexao(pedido("desconectar"), c.deps)).estado).toBe("sem_sessao");
        expect(c.manager.removeInstance).not.toHaveBeenCalled();
    });
});

describe("historico e isolamento", () => {
    it("devolve só os avisos da própria barraca, no formato do contrato", async () => {
        const c = cenario({ vinculos: { [A]: "sA", [B]: "sB" } });
        const a = await executarAcaoConexao(pedido("historico", A), c.deps);
        expect(a.avisos).toEqual([{ pedido_id: "p1", tipo: "pronto", estado: "enviado", motivo: null, em: "2026-10-23T12:00:00.000Z" }]);
        const b = await executarAcaoConexao(pedido("historico", B), c.deps);
        expect(b.avisos).toEqual([]);
        expect(c.db.avisoPedido.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: { barracaId: A }, take: 20 }));
        expect(c.db.avisoPedido.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: { barracaId: B } }));
    });
    it("a barraca A nunca enxerga o QR nem o número da B", async () => {
        const c = cenario({
            vinculos: { [A]: "sA", [B]: "sB" },
            instancias: { sB: { status: "SCAN_QR", qr: "2@qr-da-B", socket: null } },
        });
        const a = await executarAcaoConexao(pedido("status", A), c.deps);
        expect(JSON.stringify(a)).not.toContain("qr-da-B");
        expect(a.estado).toBe("desconectado");
    });
    it("status não traz o campo avisos", async () => {
        const c = cenario({ vinculos: { [A]: "sA" } });
        expect(await executarAcaoConexao(pedido("status"), c.deps)).not.toHaveProperty("avisos");
    });
});
