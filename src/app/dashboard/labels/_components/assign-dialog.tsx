"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Contact } from "./types";

export function AssignDialog({ open, onOpenChange, search, onSearchChange, contacts, loading, onAssign }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    search: string;
    onSearchChange: (v: string) => void;
    contacts: Contact[];
    loading: boolean;
    onAssign: (jid: string) => void;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Atribuir conversa à etiqueta</DialogTitle>
                    <DialogDescription>Busque um contato ou informe um JID para atribuir a esta etiqueta.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                    <div className="relative">
                        <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Buscar contatos ou informar JID..."
                            className="pl-9"
                            value={search}
                            onChange={(e) => onSearchChange(e.target.value)}
                            autoFocus
                        />
                    </div>

                    <div className="max-h-[300px] overflow-y-auto space-y-1">
                        {loading ? (
                            <div className="flex items-center justify-center py-6">
                                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                            </div>
                        ) : contacts.length > 0 ? (
                            contacts.map((c) => (
                                <button
                                    key={c.id}
                                    className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted/50 transition-colors text-left"
                                    onClick={() => onAssign(c.jid)}
                                >
                                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                                        {(c.name || c.notify || c.jid).charAt(0).toUpperCase()}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-medium truncate">{c.name || c.notify || "Desconhecido"}</p>
                                        <p className="text-[11px] text-muted-foreground font-mono truncate">{c.jid}</p>
                                    </div>
                                    <Badge variant="outline" className="text-[10px] shrink-0">Atribuir</Badge>
                                </button>
                            ))
                        ) : search.trim() ? (
                            <div className="text-center py-6 space-y-3">
                                <p className="text-sm text-muted-foreground">Nenhum contato encontrado</p>
                                {search.includes("@") && (
                                    <Button variant="outline" size="sm" onClick={() => onAssign(search.trim())}>
                                        Atribuir &quot;{search.trim()}&quot; diretamente
                                    </Button>
                                )}
                            </div>
                        ) : (
                            <p className="text-sm text-muted-foreground text-center py-6">
                                Digite para buscar contatos...
                            </p>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
