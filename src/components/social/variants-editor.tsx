"use client";

import { useRef, useState } from "react";
import { ImagePlus, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PostType, SeriesVariant, api, mediaSrc } from "./types";

const MAX_VARIANTS = 12;

interface Props {
    type: PostType;
    variants: SeriesVariant[];
    onChange: (v: SeriesVariant[]) => void;
    /** menor limite de legenda entre as contas escolhidas */
    captionLimit: number;
}

/** Lista de variações da série: cada uma tem suas imagens e legenda; saem em ordem, uma por ocorrência. */
export function VariantsEditor({ type, variants, onChange, captionLimit }: Props) {
    const input = useRef<HTMLInputElement>(null);
    const [target, setTarget] = useState(0);
    const [uploading, setUploading] = useState(false);

    const patch = (i: number, p: Partial<SeriesVariant>) => onChange(variants.map((v, j) => (j === i ? { ...v, ...p } : v)));

    const upload = async (files: FileList | null) => {
        if (!files?.length) return;
        setUploading(true);
        try {
            const added: string[] = [];
            for (const f of Array.from(files)) {
                const body = new FormData();
                body.append("file", f);
                const j = await api<{ data: { url: string } }>("/api/uploads", { method: "POST", body });
                added.push(j.data.url.split("/").pop() as string);
            }
            const cur = variants[target]?.mediaIds ?? [];
            patch(target, { mediaIds: type === "STORY" ? added.slice(0, 1) : [...cur, ...added].slice(0, 10) });
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Falha ao enviar a imagem");
        } finally {
            setUploading(false);
            if (input.current) input.current.value = "";
        }
    };

    return (
        <div className="space-y-3">
            <input ref={input} type="file" multiple={type === "FEED"} accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => upload(e.target.files)} />
            {variants.map((v, i) => (
                <div key={i} className="space-y-2 rounded-lg border p-3">
                    <div className="flex items-center justify-between">
                        <Label>Variação {i + 1}</Label>
                        {variants.length > 1 && (
                            <Button type="button" size="sm" variant="ghost" onClick={() => onChange(variants.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                        )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {v.mediaIds.map((id) => (
                            <div key={id} className="relative">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={mediaSrc(id)} alt="" className="h-20 w-20 rounded-md border object-cover" />
                                <button type="button" className="absolute -right-2 -top-2 rounded-full border bg-background p-0.5" onClick={() => patch(i, { mediaIds: v.mediaIds.filter((x) => x !== id) })}><X className="h-3 w-3" /></button>
                            </div>
                        ))}
                        {(type === "FEED" ? v.mediaIds.length < 10 : v.mediaIds.length < 1) && (
                            <Button type="button" variant="outline" size="sm" className="h-20 w-20 flex-col" disabled={uploading} onClick={() => { setTarget(i); input.current?.click(); }}>
                                <ImagePlus className="h-5 w-5" />{uploading && target === i ? "Enviando…" : "Imagem"}
                            </Button>
                        )}
                    </div>
                    {type === "FEED" && (
                        <div className="space-y-1">
                            <Textarea rows={3} value={v.caption} onChange={(e) => patch(i, { caption: e.target.value })} placeholder="Legenda desta variação" />
                            <p className={`text-right text-xs tabular-nums ${v.caption.length > captionLimit ? "text-destructive" : "text-muted-foreground"}`}>{v.caption.length}/{captionLimit}</p>
                        </div>
                    )}
                </div>
            ))}
            {variants.length < MAX_VARIANTS && (
                <Button type="button" variant="outline" size="sm" onClick={() => onChange([...variants, { caption: "", mediaIds: [] }])}><Plus className="mr-2 h-4 w-4" />Adicionar variação</Button>
            )}
            {variants.length > 1 && <p className="text-xs text-muted-foreground">As variações saem em ordem, uma por data: na 1ª usa a variação 1, na 2ª a variação 2… e volta ao início depois da última.</p>}
        </div>
    );
}
