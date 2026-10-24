import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { registrarAvisoDoEvento, type RegistroDb } from "./aviso-registro";
import type { ComandaEvent } from "./schema";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PEDIDO = "11111111-1111-4111-8111-111111111111";

const ev = (type: ComandaEvent["type"], data: Record<string, unknown> = {}, barraca = A): ComandaEvent => ({
    id: crypto.randomUUID(), type, version: 1, occurred_at: "2026-10-23T12:00:00Z", barraca_id: barraca, sequence: 1,
    data: { pedido_id: PEDIDO, senha: 42, status: "a_fazer", tipo_atendimento: "retirada", cliente: { nome: "Maria Teste", telefone: "61999990001" }, ...data },
});

/** Banco falso: só a barraca A tem sessão; a chave única é (barraca, pedido, tipo). */
function banco() {
    const linhas: Record<string, unknown>[] = [];
    const db: RegistroDb = {
        barracaSessao: { findFirst: async (a) => ((a as { where: { barracaId: string } }).where.barracaId === A ? { sessionId: "s", createdAt: new Date() } : null) },
        avisoPedido: {
            create: async (a) => {
                const d = (a as { data: Record<string, unknown> }).data;
                if (linhas.some((l) => l.barracaId === d.barracaId && l.pedidoId === d.pedidoId && l.tipo === d.tipo)) throw Object.assign(new Error("dup"), { code: "P2002" });
                linhas.push(d);
                return d;
            },
        },
    };
    return { db, linhas };
}

describe("registrarAvisoDoEvento", () => {
    it("grava pendente com telefone E.164 e texto montado", async () => {
        const { db, linhas } = banco();
        expect(await registrarAvisoDoEvento(ev("order.created", { barraca_nome: "Açaí do Didi" }), db)).toBe("registrado");
        expect(linhas).toHaveLength(1);
        expect(linhas[0]).toMatchObject({ tipo: "recebido", estado: "pendente", barracaId: A, pedidoId: PEDIDO });
        expect(linhas[0].payload).toEqual({ telefone: "5561999990001", texto: "Olá Maria! Recebemos seu pedido #42 na Açaí do Didi. Avisamos assim que estiver pronto." });
    });

    it("o mesmo evento duas vezes (inclusive após reiniciar): um único aviso", async () => {
        const { db, linhas } = banco();
        const e = ev("order.ready");
        expect(await registrarAvisoDoEvento(e, db)).toBe("registrado");
        expect(await registrarAvisoDoEvento({ ...e, id: crypto.randomUUID() }, db)).toBe("duplicado");
        expect(linhas).toHaveLength(1);
    });

    it("pedido sem telefone: estado pulado_sem_telefone, sem payload", async () => {
        const { db, linhas } = banco();
        await registrarAvisoDoEvento(ev("order.ready", { cliente: { nome: "Ana", telefone: null } }), db);
        expect(linhas[0]).toMatchObject({ estado: "pulado_sem_telefone" });
        expect(linhas[0].payload).toBeUndefined();
    });

    it("aviso desligado pela loja não envia e registra", async () => {
        const { db, linhas } = banco();
        await registrarAvisoDoEvento(ev("order.ready", { avisos: { pronto: { ativo: false, texto: null } } }), db);
        expect(linhas[0]).toMatchObject({ estado: "pulado_nao_aplica", motivo: "desativado_pela_loja" });
    });

    it("texto da loja substitui o padrão", async () => {
        const { db, linhas } = banco();
        await registrarAvisoDoEvento(ev("order.cancelled", { avisos: { cancelado: { ativo: true, texto: "Sentimos muito, {nome}." } } }), db);
        expect((linhas[0].payload as { texto: string }).texto).toBe("Sentimos muito, Maria.");
    });

    it("pedido que nasce entregue: o 'entregue' seguinte não avisa", async () => {
        const { db, linhas } = banco();
        await registrarAvisoDoEvento(ev("order.created", { status: "entregue" }), db);
        expect(linhas.map((l) => `${l.tipo}:${l.estado}`).sort()).toEqual(["entregue:pulado_nao_aplica", "recebido:pendente"]);
        expect(await registrarAvisoDoEvento(ev("order.status_changed", { status: "entregue" }), db)).toBe("duplicado");
    });

    it("entregue de pedido comum avisa uma vez, mesmo com correção e nova entrega", async () => {
        const { db, linhas } = banco();
        await registrarAvisoDoEvento(ev("order.created"), db);
        expect(await registrarAvisoDoEvento(ev("order.status_changed", { status: "entregue" }), db)).toBe("registrado");
        expect(await registrarAvisoDoEvento(ev("order.status_changed", { status: "entregue" }), db)).toBe("duplicado");
        expect(linhas.filter((l) => l.tipo === "entregue")).toHaveLength(1);
    });

    it("barraca sem sessão e eventos sem aviso são ignorados", async () => {
        const { db, linhas } = banco();
        expect(await registrarAvisoDoEvento(ev("order.ready", {}, B), db)).toBe("sem_sessao");
        expect(await registrarAvisoDoEvento(ev("order.paid"), db)).toBe("ignorado");
        expect(await registrarAvisoDoEvento(ev("order.status_changed", { status: "pronto" }), db)).toBe("ignorado");
        expect(linhas).toHaveLength(0);
    });

    it("falha de banco propaga (a rota responde 503)", async () => {
        const { db } = banco();
        db.avisoPedido.create = async () => { throw new Error("banco fora"); };
        await expect(registrarAvisoDoEvento(ev("order.ready"), db)).rejects.toThrow("banco fora");
    });
});
