"use client";

import { ReactNode } from "react";
import { useSession } from "@/components/dashboard/session-provider";

// A key por sessão recria as páginas de cliente na troca, para não sobrar dado da sessão anterior.
export function SessionScope({ children }: { children: ReactNode }) {
    const { sessionId } = useSession();
    return <div key={sessionId} className="contents">{children}</div>;
}
