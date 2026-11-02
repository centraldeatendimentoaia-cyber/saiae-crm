import { describe, it, expect } from "vitest";
import { agruparJidsEquivalentes } from "@/lib/jid-utils";
import { juntarConversas, type LinhaConversa } from "./chat-lista";

const TEL = "5561999990000@s.whatsapp.net";
const LID = "123456789@lid";
const linha = (remoteJid: string, seg: number, content = "x"): LinhaConversa => ({ remoteJid, content, timestamp: new Date(seg * 1000), type: "TEXT" });

describe("juntarConversas", () => {
    it("junta a conversa do telefone (IA envia) com a do LID (cliente responde)", () => {
        const classes = agruparJidsEquivalentes([{ jid: TEL, lid: LID }]);
        const r = juntarConversas([linha(LID, 20, "resposta da cliente"), linha(TEL, 10, "msg da IA")], classes);
        expect(r).toHaveLength(1);
        expect(r[0].jid).toBe(TEL);
        expect(r[0].jids.sort()).toEqual([LID, TEL].sort());
        expect(r[0].ultima.content).toBe("resposta da cliente");
    });
    it("sem ligação conhecida, mantém as conversas separadas", () => {
        const r = juntarConversas([linha(LID, 20), linha(TEL, 10)], new Map());
        expect(r.map((c) => c.jid)).toEqual([LID, TEL]);
    });
    it("ordena da mais recente para a mais antiga depois de juntar", () => {
        const classes = agruparJidsEquivalentes([{ jid: TEL, lid: LID }]);
        const r = juntarConversas([linha("a@s.whatsapp.net", 30), linha(LID, 20), linha(TEL, 10), linha("b@s.whatsapp.net", 5)], classes);
        expect(r.map((c) => c.jid)).toEqual(["a@s.whatsapp.net", TEL, "b@s.whatsapp.net"]);
    });
});
