import { useState, useEffect } from "react";
import { toast } from "sonner";
import { logger } from "@/lib/logger";
import { DEFAULT_BOT_CONFIG, DEFAULT_PRIVACY_CONFIG, type BotConfig, type JidListName } from "./types";

// Carrega e salva a configuracao do bot e a de privacidade da sessao ativa.
export function useBotSettings(sessionId: string | null | undefined) {
    const [botConfig, setBotConfig] = useState<BotConfig>(DEFAULT_BOT_CONFIG);
    const [botLoading, setBotLoading] = useState(false);
    const [newJid, setNewJid] = useState("");

    const [privacyConfig, setPrivacyConfig] = useState(DEFAULT_PRIVACY_CONFIG);
    const [privacyLoading, setPrivacyLoading] = useState(false);

    useEffect(() => {
        if (!sessionId) return;

        fetch(`/api/sessions/${sessionId}/bot-config`)
            .then(res => { if (!res.ok) throw new Error(); return res.json(); })
            .then(responseData => {
                const data = responseData?.data;
                if (data && !responseData.error) {
                    setBotConfig(prev => ({
                        ...prev,
                        ...data,
                        removeBgApiKey: data.removeBgApiKey || "",
                        prefix: data.prefix || "#",
                        welcomeMessage: data.welcomeMessage || "",
                        botAllowedJids: data.botAllowedJids || [],
                        botBlockedJids: data.botBlockedJids || [],
                        autoReplyAllowedJids: data.autoReplyAllowedJids || [],
                        autoReplyBlockedJids: data.autoReplyBlockedJids || [],
                    }));
                }
            })
            .catch(() => { });

        fetch(`/api/sessions/${sessionId}/settings`)
            .then(res => { if (!res.ok) throw new Error(); return res.json(); })
            .then(responseData => {
                const data = responseData?.data;
                if (data && !responseData.error) {
                    setPrivacyConfig({
                        ghostMode: data.config?.ghostMode || false,
                        antiDelete: data.config?.antiDelete || false,
                        readReceipts: data.config?.readReceipts ?? true
                    });
                }
            })
            .catch(() => { });
    }, [sessionId]);

    const updateBot = (patch: Partial<BotConfig>) => setBotConfig(prev => ({ ...prev, ...patch }));

    const handleSaveBot = async () => {
        if (!sessionId) return;
        setBotLoading(true);
        try {
            const res = await fetch(`/api/sessions/${sessionId}/bot-config`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(botConfig)
            });

            if (res.ok) {
                toast.success("Configuração do bot salva");
            } else {
                toast.error("Falha ao salvar a configuração do bot");
            }
        } catch (e) {
            logger.error("BotSettings", "Falha ao salvar a configuração do bot", e);
            toast.error("Erro ao salvar a configuração do bot");
        } finally {
            setBotLoading(false);
        }
    };

    const handleSavePrivacy = async () => {
        if (!sessionId) return;
        setPrivacyLoading(true);
        try {
            const res = await fetch(`/api/sessions/${sessionId}/settings`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    config: {
                        ghostMode: privacyConfig.ghostMode,
                        antiDelete: privacyConfig.antiDelete,
                        readReceipts: privacyConfig.readReceipts
                    }
                })
            });

            if (res.ok) {
                toast.success("Configurações de privacidade salvas");
            } else {
                toast.error("Falha ao salvar as configurações de privacidade");
            }
        } catch (e) {
            logger.error("BotSettings", "Falha ao salvar as configurações de privacidade", e);
            toast.error("Erro ao salvar as configurações de privacidade");
        } finally {
            setPrivacyLoading(false);
        }
    };

    const addJid = (listName: JidListName) => {
        if (!newJid || !newJid.trim()) return;
        let formatted = newJid.trim();
        if (!formatted.includes('@')) formatted += '@s.whatsapp.net';

        if (!botConfig[listName].includes(formatted)) {
            setBotConfig(prev => ({
                ...prev,
                [listName]: [...prev[listName], formatted]
            }));
        }
        setNewJid("");
    };

    const removeJid = (listName: JidListName, jid: string) => {
        setBotConfig(prev => ({
            ...prev,
            [listName]: prev[listName].filter(item => item !== jid)
        }));
    };

    return {
        botConfig, updateBot, botLoading, handleSaveBot,
        privacyConfig, setPrivacyConfig, privacyLoading, handleSavePrivacy,
        newJid, setNewJid, addJid, removeJid,
    };
}
