"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Account, Post, Signature, api } from "./types";

/** Conteúdo para abrir o editor já preenchido (nova postagem). */
export interface EditorSeed {
    date?: string; // ISO — primeira data da lista
    accountIds?: string[];
    type?: "FEED" | "STORY";
    caption?: string;
    mediaIds?: string[];
}

export type EditorState = { mode: "closed" } | { mode: "create"; seed: EditorSeed } | { mode: "edit"; postId: string };

interface Ctx {
    accounts: Account[];
    accountsLoaded: boolean;
    signatures: Signature[];
    /** "all" ou id da conta */
    filter: string;
    setFilter: (v: string) => void;
    editor: EditorState;
    openCreate: (seed?: EditorSeed) => void;
    openEdit: (post: Pick<Post, "id">) => void;
    closeEditor: () => void;
    /** sobe a cada alteração: as telas refazem a busca quando muda */
    version: number;
    bump: () => void;
    reloadAccounts: () => Promise<void>;
    reloadSignatures: () => Promise<void>;
}

const SocialCtx = createContext<Ctx | null>(null);

export function useSocial(): Ctx {
    const c = useContext(SocialCtx);
    if (!c) throw new Error("useSocial fora do SocialProvider");
    return c;
}

export function SocialProvider({ children }: { children: React.ReactNode }) {
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [accountsLoaded, setAccountsLoaded] = useState(false);
    const [signatures, setSignatures] = useState<Signature[]>([]);
    const [filter, setFilterState] = useState("all");
    const [editor, setEditor] = useState<EditorState>({ mode: "closed" });
    const [version, setVersion] = useState(0);

    const reloadAccounts = useCallback(async () => {
        try {
            setAccounts((await api<{ data: Account[] }>("/api/social/accounts")).data);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Falha ao carregar as contas");
        } finally {
            setAccountsLoaded(true);
        }
    }, []);

    const reloadSignatures = useCallback(async () => {
        try {
            setSignatures((await api<{ data: Signature[] }>("/api/social/signatures")).data);
        } catch {
            /* os textos salvos são conveniência */
        }
    }, []);

    useEffect(() => {
        reloadAccounts();
        reloadSignatures();
        try {
            const saved = localStorage.getItem("social:filter");
            if (saved) setFilterState(saved);
        } catch { /* sem localStorage */ }
    }, [reloadAccounts, reloadSignatures]);

    // se a conta filtrada foi desconectada, volta para "todas"
    useEffect(() => {
        if (accountsLoaded && filter !== "all" && !accounts.some((a) => a.id === filter)) setFilterState("all");
    }, [accounts, accountsLoaded, filter]);

    const value = useMemo<Ctx>(
        () => ({
            accounts, accountsLoaded, signatures, filter,
            setFilter: (v) => {
                setFilterState(v);
                try { localStorage.setItem("social:filter", v); } catch { /* ok */ }
            },
            editor,
            openCreate: (seed = {}) => setEditor({ mode: "create", seed }),
            openEdit: (post) => setEditor({ mode: "edit", postId: post.id }),
            closeEditor: () => setEditor({ mode: "closed" }),
            version,
            bump: () => setVersion((v) => v + 1),
            reloadAccounts, reloadSignatures,
        }),
        [accounts, accountsLoaded, signatures, filter, editor, version, reloadAccounts, reloadSignatures]
    );

    return <SocialCtx.Provider value={value}>{children}</SocialCtx.Provider>;
}
