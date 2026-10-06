"use client";

import * as React from "react";
import { Textarea } from "@/components/ui/textarea";
import { EmojiPicker } from "@/components/emoji-picker";

type Props = Omit<React.ComponentProps<"textarea">, "value" | "onChange"> & {
    value: string;
    onValueChange: (value: string) => void;
    /** Botões extras ao lado do seletor de emoji (ex.: variáveis como {primeironome}). */
    toolbar?: React.ReactNode;
};

/** Caixa de texto com seletor de emojis: o emoji entra na posição do cursor. */
export function EmojiTextarea({ value, onValueChange, toolbar, disabled, maxLength, ...props }: Props) {
    const ref = React.useRef<HTMLTextAreaElement>(null);

    const insert = (emoji: string) => {
        const el = ref.current;
        const start = el?.selectionStart ?? value.length;
        const end = el?.selectionEnd ?? value.length;
        const next = value.slice(0, start) + emoji + value.slice(end);
        if (maxLength && next.length > maxLength) return;
        onValueChange(next);
        requestAnimationFrame(() => {
            if (!el) return;
            el.focus();
            const pos = start + emoji.length;
            el.setSelectionRange(pos, pos);
        });
    };

    return (
        <div className="space-y-2">
            <Textarea
                ref={ref}
                value={value}
                onChange={(e) => onValueChange(e.target.value)}
                disabled={disabled}
                maxLength={maxLength}
                {...props}
            />
            <div className="flex flex-wrap items-center gap-2">
                <EmojiPicker onPick={insert} disabled={disabled} />
                {toolbar}
                {maxLength ? (
                    <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                        {value.length}/{maxLength}
                    </span>
                ) : null}
            </div>
        </div>
    );
}
