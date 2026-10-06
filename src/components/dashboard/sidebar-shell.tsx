"use client";

import { SidebarNav } from "./sidebar-nav";
import { useSidebar } from "./sidebar-context";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import { signOut } from "next-auth/react";
import { BrandLogo } from "@/components/brand-logo";

interface SidebarShellProps {
    appName: string;
    userName?: string | null;
    userEmail?: string | null;
    version: string;
}

export function SidebarShell({ appName, userName, userEmail, version }: SidebarShellProps) {
    const { isCollapsed } = useSidebar();

    return (
        <aside
            className={`
                bg-sidebar text-sidebar-foreground border-r border-sidebar-border
                hidden md:flex flex-col h-full sticky left-0 top-0 z-20
                transition-all duration-300 ease-in-out
                ${isCollapsed ? "w-[72px]" : "w-[260px]"}
            `}
        >
            {/* Logo / Brand */}
            <div className={`border-b border-sidebar-border transition-all duration-300 ${isCollapsed ? "px-3 py-4" : "px-5 py-5"}`}>
                {isCollapsed ? (
                    <div className="flex justify-center">
                        <img src="/brand/saiae-icone.svg" alt={appName} className="h-10 w-10" />
                    </div>
                ) : (
                    <>
                        <BrandLogo tone="dark" className="h-9" />
                        <p className="text-[11px] text-sidebar-foreground/60 mt-2 font-bold uppercase tracking-[0.08em]">Disparador de WhatsApp</p>
                    </>
                )}
            </div>

            {/* Navigation */}
            <SidebarNav />

            {/* User Footer */}
            <div 
                suppressHydrationWarning={true}
                className={`border-t border-sidebar-border transition-all duration-300 ${isCollapsed ? "p-2" : "p-4"}`}
            >
                {isCollapsed ? (
                    <div suppressHydrationWarning={true} className="flex flex-col items-center gap-2">
                        <div suppressHydrationWarning={true} className="h-8 w-8 rounded-lg bg-brand text-brand-foreground flex items-center justify-center text-sm font-bold">
                            {userName?.charAt(0)?.toUpperCase() || "U"}
                        </div>
                        <button
                            onClick={() => signOut({ callbackUrl: "/auth/login" })}
                            className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        >
                            <LogOut size={16} />
                        </button>
                    </div>
                ) : (
                    <>
                        <div suppressHydrationWarning={true} className="flex items-center gap-2.5 mb-3">
                            <div 
                                suppressHydrationWarning={true}
                                className="h-8 w-8 rounded-lg bg-brand text-brand-foreground flex items-center justify-center text-sm font-bold"
                            >
                                {userName?.charAt(0)?.toUpperCase() || "U"}
                            </div>
                            <div suppressHydrationWarning={true} className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-sidebar-foreground truncate">{userName || "Usuário"}</p>
                                <p className="text-[10px] text-muted-foreground truncate">{userEmail}</p>
                            </div>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            className="w-full flex items-center justify-center gap-2 text-sm h-10 rounded-xl bg-transparent text-sidebar-foreground shadow-[inset_0_0_0_1.5px_var(--color-sidebar-border)] hover:bg-sidebar-accent hover:text-white"
                            onClick={() => signOut({ callbackUrl: "/auth/login" })}
                        >
                            <LogOut size={14} />  Sair
                        </Button>
                        <p className="text-[9px] text-muted-foreground/50 text-center mt-2 font-mono">v{version}</p>
                    </>
                )}
            </div>
        </aside>
    );
}
