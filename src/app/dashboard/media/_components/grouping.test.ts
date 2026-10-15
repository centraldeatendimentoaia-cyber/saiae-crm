import { describe, it, expect } from "vitest";
import { groupMedia, collapsibleKeys, getSenderDisplay, matchesFilters, formatFileSize, type MediaFile } from "./grouping";

const file = (over: Partial<MediaFile>): MediaFile => ({
    name: "a.jpg", size: 100, type: "image", ext: "jpg",
    sessionId: "s1", sessionName: "Sessao 1", ownerName: "Dono", ownerId: "u1",
    from: "5511999999999@s.whatsapp.net", fromName: null, fromMe: false,
    createdAt: "2026-01-01T00:00:00Z", modifiedAt: "2026-01-01T00:00:00Z", url: "/m/a.jpg",
    ...over,
});

describe("groupMedia", () => {
    it("agrupa por usuario, sessao e remetente somando tamanhos", () => {
        const g = groupMedia([
            file({ name: "a", size: 10 }),
            file({ name: "b", size: 30 }),
            file({ name: "c", size: 5, fromMe: true }),
        ]);
        expect(g).toHaveLength(1);
        expect(g[0].totalSize).toBe(45);
        const senders = g[0].sessions[0].senders;
        expect(senders.map(s => s.senderKey)).toEqual(["5511999999999@s.whatsapp.net", "_me_"]);
        expect(senders[0].files).toHaveLength(2);
    });

    it("ordena usuarios por tamanho decrescente", () => {
        const g = groupMedia([
            file({ ownerId: "u1", size: 1 }),
            file({ ownerId: "u2", ownerName: "Outro", size: 99 }),
        ]);
        expect(g.map(u => u.ownerId)).toEqual(["u2", "u1"]);
    });

    it("retorna vazio sem arquivos", () => {
        expect(groupMedia([])).toEqual([]);
    });
});

describe("collapsibleKeys", () => {
    it("gera uma chave por usuario, sessao e remetente", () => {
        const keys = collapsibleKeys(groupMedia([file({})]));
        expect([...keys]).toEqual([
            "user:u1",
            "session:u1:s1",
            "sender:u1:s1:5511999999999@s.whatsapp.net",
        ]);
    });
});

describe("getSenderDisplay", () => {
    it("prioriza fromMe, depois nome, depois numero", () => {
        expect(getSenderDisplay(file({ fromMe: true }))).toBe("Eu (enviado)");
        expect(getSenderDisplay(file({ fromName: "Maria" }))).toBe("Maria");
        expect(getSenderDisplay(file({}))).toBe("5511999999999");
        expect(getSenderDisplay(file({ from: "Unknown" }))).toBe("Desconhecido");
    });
});

describe("matchesFilters / formatFileSize", () => {
    it("filtra por texto e tipo", () => {
        const f = file({ name: "Foto.JPG" });
        expect(matchesFilters(f, "foto", "all")).toBe(true);
        expect(matchesFilters(f, "xyz", "all")).toBe(false);
        expect(matchesFilters(f, "", "video")).toBe(false);
    });

    it("formata tamanhos", () => {
        expect(formatFileSize(0)).toBe("0 B");
        expect(formatFileSize(1536)).toBe("1.5 KB");
    });
});
