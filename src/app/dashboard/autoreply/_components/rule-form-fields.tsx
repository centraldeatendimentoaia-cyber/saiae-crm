"use client";

import { EmojiTextarea } from "@/components/emoji-textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { RuleFormValues } from "./types";

export function RuleFormFields({ values, onChange, responsePlaceholder }: {
    values: RuleFormValues;
    onChange: (values: RuleFormValues) => void;
    responsePlaceholder: string;
}) {
    const set = (patch: Partial<RuleFormValues>) => onChange({ ...values, ...patch });
    return (
        <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label>Palavra-chave</Label>
                    <Input
                        value={values.keyword}
                        onChange={(e) => set({ keyword: e.target.value })}
                        placeholder="ex.: !ajuda, ping"
                    />
                </div>
                <div className="space-y-2">
                    <Label>Tipo de correspondência</Label>
                    <Select value={values.matchType} onValueChange={(v) => set({ matchType: v })}>
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="EXACT">Correspondência exata</SelectItem>
                            <SelectItem value="CONTAINS">Contém</SelectItem>
                            <SelectItem value="STARTS_WITH">Começa com</SelectItem>
                            <SelectItem value="REGEX">Expressão regular</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>

            <div className="space-y-2">
                <Label>Selecione o público do gatilho</Label>
                <Select value={values.triggerType} onValueChange={(v) => set({ triggerType: v })}>
                    <SelectTrigger>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="ALL">Todos e grupos</SelectItem>
                        <SelectItem value="PRIVATE">Somente conversas privadas</SelectItem>
                        <SelectItem value="GROUP">Somente grupos</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <div className="space-y-2">
                <Label>Mensagem de resposta (opcional)</Label>
                <EmojiTextarea
                    value={values.response}
                    onValueChange={(v) => set({ response: v })}
                    placeholder={responsePlaceholder}
                    className="min-h-[120px]"
                />
                <p className="text-xs text-muted-foreground">Você pode usar a formatação padrão do WhatsApp (*negrito*, _itálico_, ~riscado~)</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label>URL da mídia (opcional)</Label>
                    <Input
                        value={values.mediaUrl}
                        onChange={(e) => set({ mediaUrl: e.target.value })}
                        placeholder="https://exemplo.com/imagem.jpg"
                    />
                </div>
                <div className="space-y-2">
                    <Label>Tipo de mídia</Label>
                    <Select value={values.mediaType} onValueChange={(v) => set({ mediaType: v })}>
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="image">Imagem</SelectItem>
                            <SelectItem value="video">Vídeo</SelectItem>
                            <SelectItem value="document">Documento</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>
        </div>
    );
}
