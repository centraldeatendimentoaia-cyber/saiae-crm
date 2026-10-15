import { describe, it, expect } from "vitest";
import { z } from "zod";
import { lerCorpo, validar } from "./validate";

const schema = z.object({ nome: z.string().min(1, "informe o nome"), idade: z.number().optional() });
const req = (corpo: string) => new Request("http://x", { method: "POST", body: corpo });

describe("validar / lerCorpo", () => {
    it("aceita corpo válido e devolve os dados tipados", async () => {
        const r = await lerCorpo(req('{"nome":"Ana","idade":3}'), schema);
        expect(r).toEqual({ ok: true, data: { nome: "Ana", idade: 3 } });
    });
    it("campo ausente vira 400 em pt-BR no formato { status, message, error }", async () => {
        const r = await lerCorpo(req("{}"), schema);
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.response.status).toBe(400);
        const j = await r.response.json();
        expect(j.status).toBe(false);
        expect(j.message).toBe(j.error);
        expect(j.message).toMatch(/^nome: /);
        expect(j.message).toMatch(/Entrada inválida|esperado/i);
    });
    it("usa a mensagem do schema quando existe", async () => {
        const r = validar(schema, { nome: "" });
        expect(r.ok).toBe(false);
        if (!r.ok) expect((await r.response.json()).message).toBe("nome: informe o nome");
    });
    it("JSON malformado ou vazio vira 400, não 500", async () => {
        for (const c of ["{nao json", ""]) {
            const r = await lerCorpo(req(c), schema);
            expect(r.ok).toBe(false);
            if (!r.ok) expect(r.response.status).toBe(400);
        }
    });
});
