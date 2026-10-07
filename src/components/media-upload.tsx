"use client";

import { useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

interface Props {
    /** URL interna da imagem enviada (/api/uploads/:id) ou "" */
    value: string;
    onChange: (url: string) => void;
    disabled?: boolean;
}

/** Botão para subir uma imagem (JPG, PNG ou WebP, até 5 MB) que vai junto com a mensagem. */
export function MediaUpload({ value, onChange, disabled }: Props) {
    const input = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false);

    const pick = async (file: File | undefined) => {
        if (!file) return;
        setBusy(true);
        try {
            const body = new FormData();
            body.append("file", file);
            const res = await fetch("/api/uploads", { method: "POST", body });
            const data = await res.json();
            if (!res.ok || !data.status) throw new Error(data.message || "Falha ao enviar a imagem");
            onChange(data.data.url);
        } catch (e: any) {
            toast.error(e.message || "Falha ao enviar a imagem");
        } finally {
            setBusy(false);
            if (input.current) input.current.value = "";
        }
    };

    return (
        <div className="space-y-2">
            <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={e => pick(e.target.files?.[0])} />
            {value ? (
                <div className="flex items-start gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={value} alt="Imagem do disparo" className="h-24 w-24 rounded-md border border-border object-cover" />
                    <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => onChange("")}>
                        <X /> Remover imagem
                    </Button>
                </div>
            ) : (
                <Button type="button" size="sm" variant="outline" disabled={disabled || busy} onClick={() => input.current?.click()}>
                    <ImagePlus /> {busy ? "Enviando..." : "Adicionar imagem"}
                </Button>
            )}
            <p className="text-xs text-muted-foreground">JPG, PNG ou WebP, até 5 MB. O texto vai como legenda da imagem.</p>
        </div>
    );
}
