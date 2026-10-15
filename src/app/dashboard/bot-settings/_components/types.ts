export const DEFAULT_BOT_CONFIG = {
    botName: "Saiaê Bot",
    prefix: "#",
    enableSticker: true,
    enableVideoSticker: true,
    maxStickerDuration: 10,
    enablePing: true,
    enableUptime: true,
    removeBgApiKey: "",
    botMode: "OWNER",
    autoReplyMode: "ALL",
    antiSpamEnabled: true,
    spamLimit: 5,
    spamInterval: 10,
    spamDelayMin: 1000,
    spamDelayMax: 3000,
    safeDelayMin: 10,
    safeDelayMax: 40,
    safeBatchSize: 25,
    safeBatchPause: 3,
    safeStartHour: 9,
    safeEndHour: 19,
    onlyInteracted: false,

    welcomeMessage: "",
    autoRead: false,
    alwaysOnline: false,
    botAllowedJids: [] as string[],
    botBlockedJids: [] as string[],
    autoReplyAllowedJids: [] as string[],
    autoReplyBlockedJids: [] as string[],
};

export type BotConfig = typeof DEFAULT_BOT_CONFIG;

export const DEFAULT_PRIVACY_CONFIG = {
    ghostMode: false,
    antiDelete: false,
    readReceipts: true,
};

export type PrivacyConfig = typeof DEFAULT_PRIVACY_CONFIG;

export type JidListName = "botAllowedJids" | "botBlockedJids" | "autoReplyAllowedJids" | "autoReplyBlockedJids";

// Props comuns das secoes: a config atual e uma funcao que aplica um patch parcial.
export interface SectionProps {
    config: BotConfig;
    update: (patch: Partial<BotConfig>) => void;
}
