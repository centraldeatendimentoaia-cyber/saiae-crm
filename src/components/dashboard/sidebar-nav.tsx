"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { ChevronDown, PanelLeftClose, PanelLeft } from "lucide-react";
import {
    LayoutDashboard,
    MessageSquare,
    Users,
    Settings,
    QrCode,
    ImageIcon,
    Webhook,
    CalendarClock,
    Bot,
    Bell,
    FileText,
    Code,
    Send,
    UserCheck,
    Megaphone,
    HardDrive,
    Activity,
    UserCircle,
    Tag,
    MessageCircleReply,
    Contact,
    UserPlus,
    BookOpen
} from "lucide-react";
import { useSidebar } from "./sidebar-context";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";

interface NavGroup {
    label: string;
    items: NavItem[];
}

interface NavItem {
    href: string;
    label: string;
    icon: React.ElementType;
    external?: boolean;
    superadminOnly?: boolean;
    allowedRoles?: string[];
}

const navGroups: NavGroup[] = [
    {
        label: "Principal",
        items: [
            { href: "/dashboard", label: "Painel", icon: LayoutDashboard },
            { href: "/dashboard/sessions", label: "Sessões / QR", icon: QrCode },
            { href: "/dashboard/guia", label: "Guia de uso", icon: BookOpen },
        ],
    },
    {
        label: "Mensagens",
        items: [
            { href: "/dashboard/chat", label: "Conversas", icon: MessageSquare },
            { href: "/dashboard/broadcast", label: "Disparo", icon: Megaphone },
            { href: "/dashboard/sticker", label: "Criador de figurinhas", icon: ImageIcon },
        ],
    },
    {
        label: "Contatos",
        items: [
            { href: "/dashboard/contacts", label: "Contatos", icon: UserCheck },
            { href: "/dashboard/groups", label: "Grupos", icon: Users },
            { href: "/dashboard/labels", label: "Etiquetas", icon: Tag },
        ],
    },
    {
        label: "Automação",
        items: [
            { href: "/dashboard/bot-settings", label: "Configurações do Bot", icon: Bot },
            { href: "/dashboard/autoreply", label: "Resposta automática", icon: MessageCircleReply },
            { href: "/dashboard/profile", label: "Perfil do bot", icon: UserCircle },
            { href: "/dashboard/scheduler", label: "Agendador", icon: CalendarClock },
            { href: "/dashboard/webhooks", label: "Webhooks e API", icon: Webhook },
        ],
    },
    {
        label: "Desenvolvedor",
        items: [
            { href: "/docs", label: "Documentação da API", icon: FileText },
            { href: "/swagger", label: "Swagger UI", icon: Code, external: true },
        ],
    },
    {
        label: "Administração",
        items: [
            { href: "/dashboard/media", label: "Gerenciador de mídia", icon: HardDrive },
            { href: "/dashboard/sessions/access", label: "Acesso às sessões", icon: UserPlus },
            { href: "/dashboard/users", label: "Usuários", icon: Users, superadminOnly: true },
            { href: "/dashboard/settings", label: "Configurações", icon: Settings },
            { href: "/dashboard/system-monitor", label: "Monitor do sistema", icon: Activity, superadminOnly: true },
            { href: "/dashboard/notifications", label: "Notificações", icon: Bell, superadminOnly: true },
        ],
    },
];

export function SidebarNav() {
    const pathname = usePathname();
    const { data: session } = useSession();
    const { isCollapsed, toggleCollapse } = useSidebar();
    // @ts-ignore
    const userRole = session?.user?.role;

    // Track collapsed groups — all expanded by default
    const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

    const toggleGroup = (label: string) => {
        setCollapsedGroups(prev => ({ ...prev, [label]: !prev[label] }));
    };

    const isActive = (href: string) => {
        if (href === "/dashboard") return pathname === "/dashboard";
        return pathname.startsWith(href);
    };

    return (
        <TooltipProvider delayDuration={0}>
            <nav className="flex-1 px-2 py-2 overflow-y-auto overflow-x-hidden space-y-0.5 styled-scrollbar">
                {navGroups.map((group) => {
                    const visibleItems = group.items.filter((item) => {
                        if (item.superadminOnly && userRole !== "SUPERADMIN") return false;
                        if (item.allowedRoles && (!userRole || !item.allowedRoles.includes(userRole))) return false;
                        return true;
                    });
                    if (visibleItems.length === 0) return null;

                    const isGroupCollapsed = collapsedGroups[group.label] ?? false;

                    // "Main" group doesn't show a collapsible header
                    if (group.label === "Main") {
                        return (
                            <div key={group.label} className="mb-1">
                                {visibleItems.map((item) => (
                                    <NavLink
                                        key={item.href}
                                        item={item}
                                        active={isActive(item.href)}
                                        isCollapsed={isCollapsed}
                                    />
                                ))}
                            </div>
                        );
                    }

                    return (
                        <div key={group.label} className="mb-1">
                            {/* Group header — hidden when sidebar collapsed */}
                            {!isCollapsed && (
                                <button
                                    onClick={() => toggleGroup(group.label)}
                                    className="flex items-center justify-between w-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-sidebar-foreground/50 hover:text-sidebar-foreground transition-colors group"
                                >
                                    {group.label}
                                    <ChevronDown
                                        size={12}
                                        className={`transition-transform duration-200 ${isGroupCollapsed ? "-rotate-90" : ""}`}
                                    />
                                </button>
                            )}

                            {/* Collapsed sidebar: show a thin divider between groups */}
                            {isCollapsed && (
                                <div className="mx-3 my-2 border-t border-sidebar-border" />
                            )}

                            {(!isGroupCollapsed || isCollapsed) && (
                                <div className="space-y-0.5">
                                    {visibleItems.map((item) => (
                                        <NavLink
                                            key={item.href}
                                            item={item}
                                            active={isActive(item.href)}
                                            isCollapsed={isCollapsed}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </nav>

            {/* Collapse Toggle Button */}
            <div className="px-2 py-2 border-t border-sidebar-border">
                <button
                    onClick={toggleCollapse}
                    className="flex items-center justify-center w-full gap-2 px-3 py-2 rounded-xl text-sm font-semibold text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-all duration-150"
                >
                    {isCollapsed ? (
                        <PanelLeft size={18} />
                    ) : (
                        <>
                            <PanelLeftClose size={16} />
                            <span>Recolher</span>
                        </>
                    )}
                </button>
            </div>
        </TooltipProvider>
    );
}

function NavLink({ item, active, isCollapsed }: { item: NavItem; active: boolean; isCollapsed: boolean }) {
    const Icon = item.icon;

    const linkContent = (
        <Link
            href={item.href}
            target={item.external ? "_blank" : undefined}
            className={`
                flex items-center rounded-xl text-[15px] font-semibold
                transition-all duration-200 group relative
                ${isCollapsed ? "justify-center px-2 py-2.5 mx-1" : "gap-3 px-3 py-2"}
                ${active
                    ? "text-white bg-sidebar-accent"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                }
            `}
        >
            {active && !isCollapsed && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[4px] h-6 bg-brand rounded-r-full" />
            )}
            <Icon
                size={isCollapsed ? 22 : 20}
                className={`flex-shrink-0 transition-colors duration-200 ${active ? "text-brand" : "text-sidebar-foreground/60 group-hover:text-sidebar-foreground"}`}
            />
            {!isCollapsed && <span className="truncate">{item.label}</span>}
        </Link>
    );

    if (isCollapsed) {
        return (
            <Tooltip>
                <TooltipTrigger asChild>
                    {linkContent}
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                    <p className="text-xs font-medium">{item.label}</p>
                </TooltipContent>
            </Tooltip>
        );
    }

    return linkContent;
}
