"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2, Image as ImageIcon, Pencil } from "lucide-react";
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
import type { AutoReply } from "./types";

export function RuleCard({ rule, onEdit, onDelete }: {
    rule: AutoReply;
    onEdit: (rule: AutoReply) => void;
    onDelete: (ruleId: string) => void;
}) {
    return (
        <Card className="flex flex-col h-full hover:shadow-md transition-shadow">
            <CardHeader className="pb-3 border-b">
                <div className="flex justify-between items-start">
                    <div className="space-y-1 pr-2">
                        <CardTitle className="text-lg flex items-center gap-2">
                            <span className="font-mono bg-muted px-2 py-0.5 rounded text-sm break-all">{rule.keyword}</span>
                        </CardTitle>
                        <div className="flex gap-2 flex-wrap text-xs">
                            <Badge variant="outline" className="text-muted-foreground font-normal shrink-0">{rule.matchType}</Badge>
                            <Badge variant="secondary" className="font-normal shrink-0 text-[10px]">{rule.triggerType}</Badge>
                        </div>
                    </div>
                    <div className="shrink-0 flex gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:bg-muted" onClick={() => onEdit(rule)}>
                            <Pencil className="w-4 h-4" />
                        </Button>
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10">
                                    <Trash2 className="w-4 h-4" />
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Excluir regra?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        Tem certeza de que deseja excluir a resposta automática da palavra-chave <strong>{rule.keyword}</strong>? Esta ação não pode ser desfeita.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => onDelete(rule.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                        Excluir
                                    </AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="pt-4 flex-grow flex flex-col">
                <div className="text-sm text-foreground bg-muted/30 p-3 rounded-md border whitespace-pre-wrap flex-grow">
                    {rule.response}
                </div>
                {rule.isMedia && (
                    <div className="mt-3 text-xs flex items-center gap-1 text-zinc-600 bg-zinc-50 px-2 py-1 rounded w-fit">
                        <ImageIcon className="w-3 h-3" />  Inclui anexo de mídia
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
