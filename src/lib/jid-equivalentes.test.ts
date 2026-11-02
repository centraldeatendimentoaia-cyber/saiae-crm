import { describe, it, expect } from "vitest";
import { agruparJidsEquivalentes, jidCanonico } from "./jid-utils";

const TEL = "5561999990000@s.whatsapp.net";
const LID = "123456789@lid";

describe("agruparJidsEquivalentes", () => {
    it("liga telefone e LID pelo contato do telefone (campo lid)", () => {
        const c = agruparJidsEquivalentes([{ jid: TEL, lid: LID }]);
        expect([...c.get(TEL)!].sort()).toEqual([LID, TEL].sort());
        expect(c.get(LID)).toBe(c.get(TEL));
    });
    it("liga pelo contato do LID (remoteJidAlt aponta para o telefone)", () => {
        const c = agruparJidsEquivalentes([{ jid: LID, remoteJidAlt: TEL }]);
        expect(c.get(LID)!.has(TEL)).toBe(true);
    });
    it("junta duas linhas de contato que ligam à mesma pessoa", () => {
        const c = agruparJidsEquivalentes([{ jid: LID, remoteJidAlt: TEL }, { jid: TEL, lid: LID }]);
        expect(c.get(TEL)!.size).toBe(2);
    });
    it("contato sem ligação fica sozinho e pessoas diferentes não se misturam", () => {
        const c = agruparJidsEquivalentes([{ jid: TEL }, { jid: "5511@s.whatsapp.net", lid: "9@lid" }]);
        expect(c.get(TEL)!.size).toBe(1);
        expect(c.get("9@lid")!.has(TEL)).toBe(false);
    });
});

describe("jidCanonico", () => {
    it("prefere o telefone ao LID", () => expect(jidCanonico([LID, TEL])).toBe(TEL));
    it("sem telefone, devolve o LID", () => expect(jidCanonico([LID])).toBe(LID));
});
