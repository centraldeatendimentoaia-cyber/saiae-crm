import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { NextRequest } from "next/server";

const { logger, auth } = vi.hoisted(() => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, auth: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger }));
vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/modules/whatsapp/manager", () => ({ waManager: { getInstance: vi.fn() } }));
vi.mock("@/modules/integracao/comanda/aviso-registro", () => ({
    registrarAvisoDoEvento: vi.fn().mockResolvedValue("sem_sessao"),
    barracaTemSessao: vi.fn().mockResolvedValue(false),
    sessaoDaBarraca: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/modules/integracao/comanda/aviso-worker", () => ({ iniciarWorkerAvisos: vi.fn(), acordarWorkerAvisos: vi.fn() }));

import { POST } from "./route";
import { proxy } from "@/proxy";
import { resetEventState } from "@/modules/integracao/comanda/state";
import { registerComandaEventConsumer } from "@/modules/integracao/comanda/consumers";
import type { ComandaEvent } from "@/modules/integracao/comanda/schema";

const URL_EVENTOS = "https://crm.exemplo.test/api/integracao/comanda/v1/eventos";
const BARRACA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OUTRA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SECRET = "segredo-da-barraca-com-mais-de-16-chars";
const SECRET_OUTRA = "segredo-da-outra-barraca-tambem-longo";
const PEDIDO_A = "11111111-1111-4111-8111-111111111111";
const PEDIDO_B = "22222222-2222-4222-8222-222222222222";

const exemplo = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../../../../../../modules/integracao/comanda/contrato/v1/exemplos/pedido-itens-com-opcoes.json"), "utf8")
);

const now = () => Math.floor(Date.now() / 1000);
const sign = (raw: string, ts: string, secret = SECRET) =>
    "sha256=" + crypto.createHmac("sha256", secret).update(`${ts}.${raw}`).digest("hex");

const event = (over: Record<string, unknown> = {}, data: Record<string, unknown> = { ...exemplo, pedido_id: PEDIDO_A }) => ({
    id: crypto.randomUUID(), type: "order.created", version: 1, occurred_at: "2026-10-07T20:00:00Z", barraca_id: BARRACA, sequence: 1, data, ...over,
});

interface Opts { ts?: number; secret?: string; headers?: Record<string, string | null>; raw?: string }
function send(ev: Record<string, unknown> | null, o: Opts = {}) {
    const raw = o.raw ?? JSON.stringify(ev);
    const ts = String(o.ts ?? now());
    const headers: Record<string, string> = { "content-type": "application/json", "x-saiae-timestamp": ts, "x-saiae-signature": sign(raw, ts, o.secret), "x-saiae-event-id": String(ev?.id ?? "") };
    for (const [k, v] of Object.entries(o.headers ?? {})) {
        if (v === null) delete headers[k];
        else headers[k] = v;
    }
    return POST(new NextRequest(URL_EVENTOS, { method: "POST", body: raw, headers }));
}

const unregister: (() => void)[] = [];
const consume = (fn: (e: ComandaEvent) => void | Promise<void>) => {
    const spy = vi.fn(fn);
    unregister.push(registerComandaEventConsumer(spy));
    return spy;
};
const tick = () => new Promise((r) => setTimeout(r, 15));

beforeEach(() => {
    vi.stubEnv("COMANDA_WEBHOOK_SECRETS", JSON.stringify({ [BARRACA]: SECRET, [OUTRA]: SECRET_OUTRA }));
    resetEventState();
    Object.values(logger).forEach((f) => f.mockReset());
    auth.mockReset().mockResolvedValue(null);
});
afterEach(() => {
    unregister.splice(0).forEach((u) => u());
    vi.unstubAllEnvs();
});

describe("configuração", () => {
    it.each([["ausente", ""], ["JSON inválido", "{nao é json"], ["objeto vazio", "{}"], ["lista", "[]"], ["segredo curto demais", JSON.stringify({ [BARRACA]: "curto" })]])(
        "COMANDA_WEBHOOK_SECRETS %s: 503 (nunca aceita sem segredo)",
        async (_n, value) => {
            vi.stubEnv("COMANDA_WEBHOOK_SECRETS", value);
            expect((await send(event())).status).toBe(503);
        }
    );
});

describe("tamanho e formato", () => {
    it("corpo acima de 1 MB: 413", async () => {
        const raw = "x".repeat(1_000_001);
        expect((await send(null, { raw })).status).toBe(413);
    });
    it("JSON inválido: 400", async () => {
        expect((await send(null, { raw: "{isso nao e json" })).status).toBe(400);
    });
    it("sem cabeçalho de assinatura: 401", async () => {
        expect((await send(event(), { headers: { "x-saiae-signature": null } })).status).toBe(401);
    });
    it("sem timestamp ou com timestamp que não é número: 401", async () => {
        expect((await send(event(), { headers: { "x-saiae-timestamp": null } })).status).toBe(401);
        expect((await send(event(), { headers: { "x-saiae-timestamp": "ontem" } })).status).toBe(401);
    });
});

describe("assinatura", () => {
    it("válida: 200", async () => {
        const res = await send(event());
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ received: true });
    });
    it("segredo errado: 401", async () => {
        expect((await send(event(), { secret: "outro-segredo-qualquer-longo" })).status).toBe(401);
    });
    it("segredo de OUTRA barraca não vale para esta: 401", async () => {
        expect((await send(event(), { secret: SECRET_OUTRA })).status).toBe(401);
    });
    it("cada barraca com o seu segredo: 200", async () => {
        expect((await send(event({ barraca_id: OUTRA }), { secret: SECRET_OUTRA })).status).toBe(200);
    });
    it("corpo adulterado depois de assinado: 401", async () => {
        const ev = event();
        const raw = JSON.stringify(ev);
        const ts = String(now());
        const res = await POST(new NextRequest(URL_EVENTOS, { method: "POST", body: raw.replace('"sequence":1', '"sequence":9'), headers: { "x-saiae-timestamp": ts, "x-saiae-signature": sign(raw, ts), "x-saiae-event-id": ev.id } }));
        expect(res.status).toBe(401);
    });
    it("timestamp trocado depois de assinado: 401 (o timestamp faz parte da assinatura)", async () => {
        const ev = event();
        const raw = JSON.stringify(ev);
        const sig = sign(raw, String(now()));
        const res = await POST(new NextRequest(URL_EVENTOS, { method: "POST", body: raw, headers: { "x-saiae-timestamp": String(now() + 1), "x-saiae-signature": sig, "x-saiae-event-id": ev.id } }));
        expect(res.status).toBe(401);
    });
    it("barraca desconhecida: 401, indistinguível de assinatura inválida", async () => {
        const res = await send(event({ barraca_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }));
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: "Não autorizado" });
    });
    describe("segredo de plataforma (COMANDA_WHATSAPP_SEGREDO)", () => {
        const PLATAFORMA = "segredo-de-plataforma-com-mais-de-16";
        const SEM_SEGREDO_PROPRIO = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
        beforeEach(() => vi.stubEnv("COMANDA_WHATSAPP_SEGREDO", PLATAFORMA));

        it("barraca sem segredo próprio assina com o de plataforma: 200", async () => {
            expect((await send(event({ barraca_id: SEM_SEGREDO_PROPRIO }), { secret: PLATAFORMA })).status).toBe(200);
        });
        it("barraca sem segredo próprio com segredo errado: 401", async () => {
            expect((await send(event({ barraca_id: SEM_SEGREDO_PROPRIO }), { secret: "outro-segredo-qualquer-longo" })).status).toBe(401);
        });
        it("barraca COM segredo próprio não aceita o de plataforma: 401", async () => {
            expect((await send(event(), { secret: PLATAFORMA })).status).toBe(401);
        });
        it("sem COMANDA_WEBHOOK_SECRETS, só com o de plataforma: 200", async () => {
            vi.stubEnv("COMANDA_WEBHOOK_SECRETS", "");
            expect((await send(event(), { secret: PLATAFORMA })).status).toBe(200);
        });
    });
    it("sem barraca_id no corpo: 401", async () => {
        const ev = event() as Record<string, unknown>;
        delete ev.barraca_id;
        expect((await send(ev)).status).toBe(401);
    });
    it.each(["sha256=zzz", "md5=abc", "", "sha256=" + "0".repeat(63)])("formato de assinatura inválido %j: 401", async (sig) => {
        expect((await send(event(), { headers: { "x-saiae-signature": sig } })).status).toBe(401);
    });
    it("rotação: o segredo novo e o antigo valem juntos", async () => {
        vi.stubEnv("COMANDA_WEBHOOK_SECRETS", JSON.stringify({ [BARRACA]: ["segredo-novo-com-mais-de-16-chars", SECRET] }));
        expect((await send(event(), { secret: SECRET })).status).toBe(200);
        expect((await send(event(), { secret: "segredo-novo-com-mais-de-16-chars" })).status).toBe(200);
        expect((await send(event(), { secret: "um-terceiro-segredo-que-nao-vale" })).status).toBe(401);
    });
});

describe("janela de tempo (5 min)", () => {
    it.each([[-299], [0], [299]])("dentro da janela (%i s): 200", async (offset) => {
        expect((await send(event(), { ts: now() + offset })).status).toBe(200);
    });
    it.each([[-301], [-3600], [301], [3600]])("fora da janela (%i s): 401", async (offset) => {
        expect((await send(event(), { ts: now() + offset })).status).toBe(401);
    });
});

describe("schema (422)", () => {
    it.each([
        ["campo obrigatório ausente", (e: Record<string, unknown>) => delete e.sequence],
        ["type desconhecido", (e: Record<string, unknown>) => (e.type = "order.exploded")],
        ["version 2", (e: Record<string, unknown>) => (e.version = 2)],
        ["id que não é uuid", (e: Record<string, unknown>) => (e.id = "123")],
        ["propriedade extra", (e: Record<string, unknown>) => (e.extra = true)],
        ["data de pedido inválido", (e: Record<string, unknown>) => (e.data = { pedido_id: PEDIDO_A })],
    ])("%s: 422 com os caminhos e sem valores", async (_n, mutate) => {
        const ev = event() as Record<string, unknown>;
        mutate(ev);
        const res = await send(ev, { headers: { "x-saiae-event-id": String(ev.id) } });
        expect(res.status).toBe(422);
        expect(await res.json()).toMatchObject({ error: "Evento fora do schema", details: expect.any(Array) });
    });
    it("X-Saiae-Event-Id diferente do id do corpo: 422", async () => {
        const res = await send(event(), { headers: { "x-saiae-event-id": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" } });
        expect(res.status).toBe(422);
    });
    it("sem X-Saiae-Event-Id: 422", async () => {
        expect((await send(event(), { headers: { "x-saiae-event-id": null } })).status).toBe(422);
    });
});

describe("exemplo oficial e todos os tipos", () => {
    it("o exemplo de docs/contrato/v1/exemplos/ vira order.created e chega ao consumidor", async () => {
        const got = consume(() => {});
        const ev = event({}, exemplo);
        const res = await send(ev);
        expect(res.status).toBe(200);
        await vi.waitFor(() => expect(got).toHaveBeenCalledTimes(1));
        expect(got.mock.calls[0][0]).toMatchObject({ id: ev.id, type: "order.created", barraca_id: BARRACA, data: { pedido_id: exemplo.pedido_id } });
    });
    it.each(["order.paid", "order.status_changed", "order.ready", "order.cancelled"])("%s: 200", async (type) => {
        expect((await send(event({ type }))).status).toBe(200);
    });
    it.each(["customer.created", "customer.updated", "coupon.redeemed"])("%s: 200", async (type) => {
        expect((await send(event({ type }, { id: "x", nome: "Maria" }))).status).toBe(200);
    });
});

describe("idempotência por id", () => {
    it("duplicata: 200 duplicate e o consumidor roda UMA vez", async () => {
        const got = consume(() => {});
        const ev = event();
        expect(await (await send(ev)).json()).toEqual({ received: true });
        expect(await (await send(ev)).json()).toEqual({ received: true, duplicate: true });
        await tick();
        expect(got).toHaveBeenCalledTimes(1);
    });
    it("entregas simultâneas do mesmo id: só uma é processada", async () => {
        const got = consume(() => {});
        const ev = event();
        const [a, b] = await Promise.all([send(ev), send(ev)]);
        const bodies = [await a.json(), await b.json()];
        expect(bodies.filter((x) => x.duplicate).length).toBe(1);
        await tick();
        expect(got).toHaveBeenCalledTimes(1);
    });
    it("ids diferentes são eventos diferentes", async () => {
        const got = consume(() => {});
        await send(event({ sequence: 1 }));
        await send(event({ sequence: 2 }));
        await tick();
        expect(got).toHaveBeenCalledTimes(2);
    });
    it("recusa por assinatura NÃO marca o id como visto (o reenvio correto passa)", async () => {
        const ev = event();
        expect((await send(ev, { secret: "segredo-errado-qualquer-longo" })).status).toBe(401);
        expect((await send(ev)).status).toBe(200);
    });
    it("evento recusado por schema NÃO marca o id como visto", async () => {
        const ev = event({ sequence: 0 });
        expect((await send(ev)).status).toBe(422);
        const corrigido = { ...ev, sequence: 1 };
        expect((await send(corrigido)).status).toBe(200);
    });
});

describe("ordem por sequence (por barraca e pedido)", () => {
    const seq = (n: number, over: Record<string, unknown> = {}, pedido = PEDIDO_A) => event({ sequence: n, ...over }, { ...exemplo, pedido_id: pedido });

    it("sequence menor que a já vista é ignorada: 200 e o consumidor NÃO roda", async () => {
        const got = consume(() => {});
        expect((await send(seq(1))).status).toBe(200);
        expect((await send(seq(3, { type: "order.status_changed" }))).status).toBe(200);
        const old = await send(seq(2, { type: "order.paid" }));
        expect(old.status).toBe(200);
        expect(await old.json()).toEqual({ received: true, ignored: "sequence_antiga" });
        await tick();
        expect(got.mock.calls.map((c) => c[0].sequence)).toEqual([1, 3]);
    });
    it("sequence igual à última é processada (só a MENOR é ignorada)", async () => {
        const got = consume(() => {});
        await send(seq(2));
        await send(seq(2, { type: "order.paid" }));
        await tick();
        expect(got).toHaveBeenCalledTimes(2);
    });
    it("a ordem é por pedido: outro pedido começa do zero", async () => {
        const got = consume(() => {});
        await send(seq(5, {}, PEDIDO_A));
        const r = await send(seq(1, {}, PEDIDO_B));
        expect(await r.json()).toEqual({ received: true });
        await tick();
        expect(got).toHaveBeenCalledTimes(2);
    });
    it("a ordem é por barraca: o mesmo pedido em outra barraca não conflita", async () => {
        const got = consume(() => {});
        await send(seq(5));
        const r = await send(seq(1, { barraca_id: OUTRA }), { secret: SECRET_OUTRA });
        expect(await r.json()).toEqual({ received: true });
        await tick();
        expect(got).toHaveBeenCalledTimes(2);
    });
    it("evento antigo reenviado é duplicata na segunda vez", async () => {
        await send(seq(3));
        const old = seq(1);
        expect((await (await send(old)).json()).ignored).toBe("sequence_antiga");
        expect((await (await send(old)).json()).duplicate).toBe(true);
    });
    it("eventos que não são de pedido não entram na regra de ordem", async () => {
        const got = consume(() => {});
        await send(event({ type: "customer.created", sequence: 9 }, { id: "c1" }));
        await send(event({ type: "customer.updated", sequence: 1 }, { id: "c1" }));
        await tick();
        expect(got).toHaveBeenCalledTimes(2);
    });
});

describe("entrega aos consumidores", () => {
    it("sem consumidor (estado atual): 200", async () => {
        expect((await send(event())).status).toBe(200);
    });
    it("responde 200 sem esperar um consumidor lento", async () => {
        let release: () => void = () => {};
        const gate = new Promise<void>((r) => (release = r));
        let done = false;
        consume(async () => {
            await gate;
            done = true;
        });
        expect((await send(event())).status).toBe(200);
        expect(done).toBe(false);
        release();
        await vi.waitFor(() => expect(done).toBe(true));
    });
    it("consumidor que falha não vira erro para a Comanda nem derruba os outros", async () => {
        consume(() => {
            throw new Error("boom com telefone 5561999990001");
        });
        const ok = consume(() => {});
        expect((await send(event())).status).toBe(200);
        await tick();
        expect(ok).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(logger.error.mock.calls)).not.toContain("5561999990001");
    });
    it("evento recusado nunca chega ao consumidor", async () => {
        const got = consume(() => {});
        await send(event(), { secret: "segredo-errado-qualquer-longo" });
        await send(event({ sequence: 0 }));
        await tick();
        expect(got).not.toHaveBeenCalled();
    });
});

describe("privacidade", () => {
    it("nenhum telefone, nome, item, observação ou segredo vai para o log (aceito, duplicado, ignorado e recusado)", async () => {
        const sensivel = { ...exemplo, pedido_id: PEDIDO_A, cliente: { nome: "Maria Secreta", telefone: "5561999990001", consentimento_contato: true } };
        const a = event({ sequence: 2 }, sensivel);
        await send(a); // aceito
        await send(a); // duplicado
        await send(event({ sequence: 1 }, sensivel)); // ignorado (sequence antiga)
        await send(event({ sequence: 0 }, sensivel)); // 422
        await send(event({}, sensivel), { secret: "segredo-errado-qualquer-longo" }); // 401
        const logged = JSON.stringify([logger.info.mock.calls, logger.warn.mock.calls, logger.error.mock.calls]);
        for (const dado of ["Maria Secreta", "5561999990001", "Yakisoba", "sem cebola", SECRET, SECRET_OUTRA, "Refrigerante"]) {
            expect(logged, dado).not.toContain(dado);
        }
        expect(logged).toContain("aceito");
        expect(logged).toContain("duplicado");
    });
});

describe("proxy", () => {
    it("o caminho exato é público (sem sessão nem chave de API)", async () => {
        const res = await proxy(new NextRequest(URL_EVENTOS, { method: "POST" }));
        expect(res.status).toBe(200);
        expect(res.headers.get("x-middleware-next")).toBe("1");
    });
    it("variações do caminho continuam exigindo sessão", async () => {
        for (const p of ["/api/integracao/comanda/v1/eventos/x", "/api/integracao/comanda/v2/eventos", "/api/integracao/comanda/v1", "/api/integracao"]) {
            const res = await proxy(new NextRequest("https://crm.exemplo.test" + p, { method: "POST" }));
            expect(res.status, p).toBe(401);
        }
    });
});
