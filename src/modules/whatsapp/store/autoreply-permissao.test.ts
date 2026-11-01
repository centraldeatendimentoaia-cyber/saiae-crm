import { describe, expect, it } from "vitest";
import type { BotConfig } from "@prisma/client";
import { canAutoReply } from "./autoreply";

// só os campos que canAutoReply lê
function config(parcial: Partial<BotConfig>): BotConfig {
    return { enabled: true, autoReplyMode: "ALL", autoReplyAllowedJids: [], autoReplyBlockedJids: [], ...parcial } as BotConfig;
}

const OUTRO = "5511999990000@s.whatsapp.net";

describe("canAutoReply", () => {
    it("modo ALL ignora a mensagem enviada pelo próprio número da sessão", () => {
        expect(canAutoReply(config({ autoReplyMode: "ALL" }), true, OUTRO)).toBe(false);
    });

    it("modo ALL responde a mensagem de outro número", () => {
        expect(canAutoReply(config({ autoReplyMode: "ALL" }), false, OUTRO)).toBe(true);
    });

    it("modo OWNER não responde a mensagem de outro número", () => {
        expect(canAutoReply(config({ autoReplyMode: "OWNER" }), false, OUTRO)).toBe(false);
    });

    it("modo SPECIFIC com lista vazia não responde a ninguém", () => {
        expect(canAutoReply(config({ autoReplyMode: "SPECIFIC", autoReplyAllowedJids: [] }), false, OUTRO)).toBe(false);
    });

    it("modo BLACKLIST com lista vazia responde a todos", () => {
        expect(canAutoReply(config({ autoReplyMode: "BLACKLIST", autoReplyBlockedJids: [] }), false, OUTRO)).toBe(true);
    });
});
