"use client";

import { useSession as useSessionProvider } from "@/components/dashboard/session-provider";
import { SessionGuard } from "@/components/dashboard/session-guard";
import { useBotSettings } from "./_components/use-bot-settings";
import { AccessSection } from "./_components/access-section";
import { AutomationSection, MediaSection } from "./_components/automation-media-sections";
import { AntiBanSection } from "./_components/anti-ban-section";
import { PrivacySection } from "./_components/privacy-section";

export default function BotSettingsPage() {
    const { sessionId } = useSessionProvider();
    const s = useBotSettings(sessionId);

    const botSave = { saving: s.botLoading, disabled: s.botLoading || !sessionId, onSave: s.handleSaveBot };

    return (
        <SessionGuard>
            <div className="space-y-6">
                <div>
                    <h2 className="text-xl sm:text-3xl font-bold tracking-tight">Configurações do Bot</h2>
                    <p className="text-muted-foreground text-sm mt-1">Configure os recursos do bot e a privacidade da sessão de WhatsApp ativa.</p>
                </div>

                <AccessSection
                    config={s.botConfig}
                    update={s.updateBot}
                    newJid={s.newJid}
                    onNewJidChange={s.setNewJid}
                    onAddJid={s.addJid}
                    onRemoveJid={s.removeJid}
                    {...botSave}
                />
                <AutomationSection config={s.botConfig} update={s.updateBot} {...botSave} />
                <MediaSection config={s.botConfig} update={s.updateBot} {...botSave} />
                <AntiBanSection config={s.botConfig} update={s.updateBot} {...botSave} />
                <PrivacySection
                    config={s.privacyConfig}
                    onChange={(patch) => s.setPrivacyConfig(prev => ({ ...prev, ...patch }))}
                    saving={s.privacyLoading}
                    disabled={s.privacyLoading || !sessionId}
                    onSave={s.handleSavePrivacy}
                />
            </div>
        </SessionGuard>
    );
}
