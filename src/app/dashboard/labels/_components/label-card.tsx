"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tag, Loader2, Pencil, Trash2, ChevronDown, ChevronUp, X, MessageSquare, UserCheck } from "lucide-react";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { LabelData, ChatLabelEntry } from "./types";

export function LabelCard({ label, expanded, chatLabels, chatLabelsLoading, onToggleExpand, onAssign, onEdit, onDelete, onRemoveChat }: {
    label: LabelData;
    expanded: boolean;
    chatLabels: ChatLabelEntry[];
    chatLabelsLoading: boolean;
    onToggleExpand: (labelId: string) => void;
    onAssign: (labelId: string) => void;
    onEdit: (label: LabelData) => void;
    onDelete: (labelId: string) => void;
    onRemoveChat: (labelId: string, jid: string) => void;
}) {
    return (
        <Card className="overflow-hidden hover:shadow-md transition-shadow">
            <div className="h-1.5 w-full" style={{ backgroundColor: label.colorHex }} />
            <CardContent className="p-4">
                {/* Label Header Row */}
                <div className="flex items-center justify-between gap-2">
                    <button
                        className="flex items-center gap-3 flex-1 min-w-0 text-left"
                        onClick={() => onToggleExpand(label.id)}
                    >
                        <Tag className="w-4 h-4 shrink-0" style={{ color: label.colorHex }} />
                        <span className="font-semibold truncate">{label.name}</span>
                        <Badge variant="secondary" className="font-normal text-xs shrink-0">
                            {label._count.chatLabels}  conversa{label._count.chatLabels !== 1 ? "s" : ""}
                        </Badge>
                        {expanded
                            ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
                            : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                        }
                    </button>

                    <div className="flex gap-1 shrink-0">
                        <Button
                            variant="ghost" size="sm"
                            className="h-8 px-2 text-primary hover:text-primary hover:bg-primary/10"
                            onClick={() => onAssign(label.id)}
                        >
                            <UserCheck className="w-3.5 h-3.5 mr-1" />
                            <span className="hidden sm:inline text-xs">Atribuir</span>
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => onEdit(label)}>
                            <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10">
                                    <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Excluir etiqueta?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        Isso excluirá permanentemente a etiqueta <strong>{label.name}</strong>  e a removerá de todas as conversas atribuídas.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => onDelete(label.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                        Excluir
                                    </AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    </div>
                </div>

                {/* Expanded Section: Assigned Chats */}
                {expanded && (
                    <div className="mt-4 pt-3 border-t space-y-2">
                        {chatLabelsLoading ? (
                            <div className="flex items-center justify-center py-4">
                                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                <span className="ml-2 text-sm text-muted-foreground">Carregando conversas...</span>
                            </div>
                        ) : chatLabels.length === 0 ? (
                            <div className="text-center py-4">
                                <MessageSquare className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                                <p className="text-sm text-muted-foreground">Nenhuma conversa atribuída a esta etiqueta ainda.</p>
                                <Button variant="outline" size="sm" className="mt-2" onClick={() => onAssign(label.id)}>
                                    <UserCheck className="w-3.5 h-3.5 mr-1.5" />  Atribuir uma conversa
                                </Button>
                            </div>
                        ) : (
                            <div className="space-y-1.5">
                                {chatLabels.map((cl) => (
                                    <div
                                        key={cl.id}
                                        className="flex items-center justify-between p-2 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                                    >
                                        <div className="flex items-center gap-2 min-w-0">
                                            <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">
                                                {(cl.contactName || cl.chatJid).charAt(0).toUpperCase()}
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-sm font-medium truncate">{cl.contactName || cl.chatJid}</p>
                                                {cl.contactName && (
                                                    <p className="text-[11px] text-muted-foreground font-mono truncate">{cl.chatJid}</p>
                                                )}
                                            </div>
                                        </div>
                                        <Button
                                            variant="ghost" size="icon"
                                            className="h-7 w-7 text-destructive/70 hover:text-destructive hover:bg-destructive/10 shrink-0"
                                            onClick={() => onRemoveChat(label.id, cl.chatJid)}
                                            title="Remover da etiqueta"
                                        >
                                            <X className="w-3.5 h-3.5" />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
