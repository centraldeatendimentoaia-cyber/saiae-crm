import { describe, expect, it } from "vitest";
import { brl, listarCardapio, montarResumo, uuidDe } from "./ferramentas";
import type { Cardapio } from "./saiae";

const cardapio: Cardapio = {
    ok: true,
    loja: { nome: "Jmal", link_cardapio: "https://x.com/c", aberta_agora: true, modos: ["retirada"], pagamentos: { na_entrega: true, pix: false }, whatsapp_dono: null, bot_habilitado: true },
    itens: [{ item_id: "i1", nome: "Pastel", categoria: "Salgados", esgotado: false, grupos: [{ grupo_id: "g1", nome: "Recheio", minimo: 1, maximo: 1, opcoes: [{ opcao_id: "o1", nome: "Carne", preco_adicional_centavos: 150 }] }] }],
};

describe("ferramentas do bot", () => {
    it("ver_cardapio lista ids e opções, nunca preço", () => {
        const t = listarCardapio(cardapio);
        expect(t).toContain("i1 | Pastel");
        expect(t).toContain("o1=Carne");
        expect(t).not.toMatch(/\d[.,]\d{2}|150|R\$/);
    });
    it("formata centavos em reais", () => expect(brl(1405)).toBe("R$ 14,05"));
    it("resumo usa só o preço do resolver e explica como confirmar", () => {
        const r = montarResumo([{ nome_item: "Pastel", quantidade: 2, preco_centavos_unitario: 700, opcoes: ["Carne"], observacao: "sem cebola" }], 1400, { na_entrega: true, pix: false });
        expect(r).toContain("2x Pastel (Carne) - sem cebola: R$ 7,00 cada");
        expect(r).toContain("Total: R$ 14,00");
        expect(r).toContain("SIM");
        expect(r).not.toContain("PIX");
    });
    it("uuidDe é estável e tem formato de UUID", () => {
        expect(uuidDe("a")).toBe(uuidDe("a"));
        expect(uuidDe("a")).not.toBe(uuidDe("b"));
        expect(uuidDe("a")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
    });
});
