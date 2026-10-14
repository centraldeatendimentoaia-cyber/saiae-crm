"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SocialProvider, useSocial } from "@/components/social/social-context";
import { PostEditor } from "@/components/social/post-editor";
import { accountLabel } from "@/components/social/types";

const TABS = [
    { href: "/dashboard/redes-sociais/calendario", label: "Calendário" },
    { href: "/dashboard/redes-sociais/series", label: "Séries" },
    { href: "/dashboard/redes-sociais/rascunhos", label: "Rascunhos" },
    { href: "/dashboard/redes-sociais/historico", label: "Histórico" },
    { href: "/dashboard/redes-sociais/contas", label: "Contas" },
];

function Shell({ children }: { children: React.ReactNode }) {
    const path = usePathname();
    const { accounts, filter, setFilter, openCreate } = useSocial();
    const filterable = !path.endsWith("/contas");

    return (
        <div className="space-y-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="flex items-center gap-2 text-xl font-bold sm:text-2xl"><Share2 className="h-5 w-5 sm:h-6 sm:w-6" /> Redes Sociais</h1>
                    <p className="text-sm text-muted-foreground">Agende postagens e Stories no Instagram e no Facebook.</p>
                </div>
                <div className="flex items-center gap-2">
                    {filterable && accounts.length > 1 && (
                        <Select value={filter} onValueChange={setFilter}>
                            <SelectTrigger className="w-full sm:w-56"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Todas as contas</SelectItem>
                                {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{accountLabel(a)}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    )}
                    <Button onClick={() => openCreate()} disabled={accounts.length === 0}><Plus className="mr-2 h-4 w-4" />Nova postagem</Button>
                </div>
            </div>

            <nav className="-mx-1 flex gap-1 overflow-x-auto border-b px-1">
                {TABS.map((t) => {
                    const active = path.startsWith(t.href);
                    return (
                        <Link key={t.href} href={t.href} className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition ${active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                            {t.label}
                        </Link>
                    );
                })}
            </nav>

            {children}
            <PostEditor />
        </div>
    );
}

export default function RedesSociaisLayout({ children }: { children: React.ReactNode }) {
    return (
        <SocialProvider>
            <Shell>{children}</Shell>
        </SocialProvider>
    );
}
