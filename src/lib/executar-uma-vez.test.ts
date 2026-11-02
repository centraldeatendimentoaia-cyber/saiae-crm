import { describe, it, expect, vi } from "vitest";
import { executarUmaVez } from "./executar-uma-vez";

describe("executarUmaVez", () => {
    it("a mesma chave roda a função uma vez, mesmo em chamadas simultâneas", async () => {
        const fn = vi.fn(async () => "enviado");
        const [a, b] = await Promise.all([executarUmaVez("c1", fn), executarUmaVez("c1", fn)]);
        expect(fn).toHaveBeenCalledTimes(1);
        expect([a, b]).toEqual(["enviado", "enviado"]);
    });
    it("chaves diferentes rodam separadas", async () => {
        const fn = vi.fn(async () => 1);
        await executarUmaVez("c2", fn);
        await executarUmaVez("c3", fn);
        expect(fn).toHaveBeenCalledTimes(2);
    });
    it("se a primeira falha, a nova tentativa roda de novo", async () => {
        const fn = vi.fn().mockRejectedValueOnce(new Error("caiu")).mockResolvedValueOnce("ok");
        await expect(executarUmaVez("c4", fn)).rejects.toThrow("caiu");
        await Promise.resolve();
        await expect(executarUmaVez("c4", fn)).resolves.toBe("ok");
        expect(fn).toHaveBeenCalledTimes(2);
    });
});
