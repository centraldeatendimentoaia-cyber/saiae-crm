import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { validateEvento } from "./schema";

const v1 = (...p: string[]) => path.resolve(__dirname, "contrato/v1", ...p);
const json = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));

const BARRACA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EVENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const pedido = json(v1("exemplos/pedido-itens-com-opcoes.json"));

const envelope = (over: Record<string, unknown> = {}, data: unknown = pedido) => ({
    id: EVENT, type: "order.created", version: 1, occurred_at: "2026-10-07T20:00:00Z", barraca_id: BARRACA, sequence: 1, data, ...over,
});

describe("contrato v1 (cópia fixada): exemplos oficiais", () => {
    it("o exemplo de pedido com opções é um `data` válido de order.created", () => {
        const r = validateEvento(envelope());
        expect(r.ok).toBe(true);
    });
    it("o exemplo de pedido vale para todos os tipos order.*", () => {
        for (const type of ["order.created", "order.paid", "order.status_changed", "order.ready", "order.cancelled"]) {
            expect(validateEvento(envelope({ type })).ok, type).toBe(true);
        }
    });
    it("o exemplo de cardápio com opções valida contra cardapio.schema.json (detecta divergência de contrato)", () => {
        const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
        addFormats(ajv);
        const validate = ajv.compile(json(v1("cardapio.schema.json")));
        expect(validate(json(v1("exemplos/cardapio-com-opcoes.json"))), JSON.stringify(validate.errors)).toBe(true);
    });
    it("os dois schemas e os exemplos existem na cópia", () => {
        for (const f of ["evento.schema.json", "cardapio.schema.json", "exemplos/pedido-itens-com-opcoes.json", "exemplos/cardapio-com-opcoes.json"]) {
            expect(fs.existsSync(v1(f)), f).toBe(true);
        }
    });
});

describe("envelope", () => {
    it.each(["customer.created", "customer.updated", "coupon.redeemed"])("%s aceita qualquer objeto em data", (type) => {
        expect(validateEvento(envelope({ type }, { qualquer: "coisa" })).ok).toBe(true);
    });
    it.each([
        ["campo obrigatório ausente (barraca_id)", (e: Record<string, unknown>) => delete e.barraca_id],
        ["type desconhecido", (e: Record<string, unknown>) => (e.type = "order.exploded")],
        ["version 2 (a v1 só aceita 1)", (e: Record<string, unknown>) => (e.version = 2)],
        ["sequence 0", (e: Record<string, unknown>) => (e.sequence = 0)],
        ["sequence fracionária", (e: Record<string, unknown>) => (e.sequence = 1.5)],
        ["id que não é uuid", (e: Record<string, unknown>) => (e.id = "123")],
        ["barraca_id que não é uuid", (e: Record<string, unknown>) => (e.barraca_id = "x")],
        ["occurred_at sem formato de data", (e: Record<string, unknown>) => (e.occurred_at = "ontem")],
        ["propriedade extra no envelope", (e: Record<string, unknown>) => (e.extra = 1)],
        ["data que não é objeto", (e: Record<string, unknown>) => (e.data = "texto")],
    ])("recusa: %s", (_n, mutate) => {
        const e = envelope() as Record<string, unknown>;
        mutate(e);
        expect(validateEvento(e).ok).toBe(false);
    });
    it.each([null, undefined, 42, "x", [], {}])("recusa corpo %j sem lançar", (body) => {
        expect(validateEvento(body).ok).toBe(false);
    });
});

describe("data dos eventos order.*", () => {
    const bad = (mutate: (p: Record<string, unknown>) => void) => {
        const p = JSON.parse(JSON.stringify(pedido));
        mutate(p);
        return validateEvento(envelope({}, p));
    };
    it("recusa pedido sem itens", () => expect(bad((p) => delete p.itens).ok).toBe(false));
    it("recusa status inválido", () => expect(bad((p) => (p.status = "voando")).ok).toBe(false));
    it("recusa total negativo", () => expect(bad((p) => (p.total_centavos = -1)).ok).toBe(false));
    it("recusa telefone fora do padrão (só dígitos, 8 a 15)", () => {
        expect(bad((p) => (p.cliente = { telefone: "+55 61 99999" })).ok).toBe(false);
        expect(bad((p) => (p.cliente = { telefone: "5561999990001", nome: "x", consentimento_contato: true })).ok).toBe(true);
    });
    it("recusa opção escolhida sem campos obrigatórios", () => {
        expect(bad((p) => ((p.itens as { opcoes?: unknown[] }[])[0].opcoes = [{ nome: "Ovo" }])).ok).toBe(false);
    });
    it("tolera campo novo desconhecido dentro do pedido (leitor tolerante, só aditivo na v1)", () => {
        expect(bad((p) => (p.campo_futuro = "x")).ok).toBe(true);
    });
    it("tolera quantidade da opção maior que 1 (reservado para versões futuras)", () => {
        expect(bad((p) => ((p.itens as { opcoes: { quantidade: number }[] }[])[0].opcoes[0].quantidade = 2)).ok).toBe(true);
    });
});

describe("mensagens de erro nunca ecoam os valores recebidos", () => {
    it("só caminho e regra, sem telefone, nome ou item", () => {
        const p = JSON.parse(JSON.stringify(pedido));
        p.cliente = { nome: "Maria Secreta", telefone: "telefone-invalido-5561999990001" };
        p.itens[0].nome = 12345;
        const r = validateEvento(envelope({}, p));
        expect(r.ok).toBe(false);
        const text = JSON.stringify(!r.ok && r.errors);
        expect(text).not.toContain("Maria Secreta");
        expect(text).not.toContain("5561999990001");
        expect(text).toContain("/data");
    });
});
