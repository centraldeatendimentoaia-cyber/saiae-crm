"use client";

import { Loader2 } from "lucide-react";
import { useSession } from "@/components/dashboard/session-provider";

export function SessionSwitchOverlay() {
    const { switchingTo } = useSession();
    if (!switchingTo) return null;
    return (
        <div role="status" aria-live="polite" className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
            <div className="flex items-center gap-3 text-lg">
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                <span>Entrando em <strong>{switchingTo}</strong>…</span>
            </div>
        </div>
    );
}
