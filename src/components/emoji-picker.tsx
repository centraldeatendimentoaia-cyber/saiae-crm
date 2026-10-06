"use client";

import { useState } from "react";
import { Smile } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const CATEGORIES: { id: string; icon: string; label: string; emojis: string[] }[] = [
    {
        id: "rostos",
        icon: "😊",
        label: "Rostos",
        emojis: ["😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "😊", "😇", "🙂", "😉", "😍", "🥰", "😘", "😋", "😛", "😜", "🤩", "🥳", "😎", "🤗", "🤭", "🤔", "😏", "😌", "😴", "🥺", "😢", "😭", "😮", "😱", "🙄", "😬", "🤤", "😤"],
    },
    {
        id: "gestos",
        icon: "👍",
        label: "Gestos",
        emojis: ["👍", "👎", "👏", "🙌", "🙏", "🤝", "💪", "👌", "✌️", "🤞", "🤟", "🤙", "👋", "🫶", "👉", "👈", "👆", "👇", "☝️", "✋", "🖐️", "✍️", "💅", "🙋", "🤷", "💁", "🙆", "🙇"],
    },
    {
        id: "coracoes",
        icon: "❤️",
        label: "Corações e símbolos",
        emojis: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💖", "💗", "💘", "💝", "✨", "⭐", "🌟", "💫", "🔥", "💥", "⚡", "🎉", "🎊", "🎁", "✅", "☑️", "❗", "❓", "⚠️", "📍", "🔔", "💯", "🆕", "🆓", "🔝", "➡️", "⬇️", "✔️"],
    },
    {
        id: "comida",
        icon: "🍔",
        label: "Comida e bebida",
        emojis: ["🍔", "🍟", "🌭", "🍕", "🌮", "🌯", "🥪", "🥟", "🥐", "🥖", "🍞", "🧀", "🍗", "🍖", "🥩", "🍳", "🥗", "🍝", "🍜", "🍣", "🍤", "🍚", "🍛", "🍰", "🎂", "🧁", "🍩", "🍪", "🍫", "🍦", "🍧", "🍨", "🍇", "🍓", "🍉", "🍍", "🥭", "🍌", "🍎", "🥑", "☕", "🍵", "🥤", "🧃", "🍹", "🍺", "🍻", "🥂", "🍷", "🍾"],
    },
    {
        id: "negocio",
        icon: "🛍️",
        label: "Negócio e compras",
        emojis: ["🛍️", "🛒", "💰", "💵", "💳", "🏷️", "🎟️", "📦", "🚚", "🛵", "🏠", "🏪", "🏬", "⏰", "🕐", "📅", "🗓️", "📣", "📢", "📲", "📱", "☎️", "💬", "📝", "📌", "🔗", "💈", "💇", "💅", "💄", "💆", "🧴", "🪞", "👗", "👠", "🎀"],
    },
    {
        id: "natureza",
        icon: "🌸",
        label: "Natureza e clima",
        emojis: ["🌸", "🌺", "🌻", "🌷", "🌹", "🌿", "🍀", "🌴", "🌞", "☀️", "🌈", "⛅", "🌧️", "❄️", "🌙", "🐶", "🐱", "🦋", "🐝", "🌊", "🏖️", "⚽", "🏆", "🎵", "🎶"],
    },
];

interface EmojiPickerProps {
    onPick: (emoji: string) => void;
    disabled?: boolean;
    className?: string;
}

/** Botão que abre uma grade de emojis (sem bibliotecas externas). */
export function EmojiPicker({ onPick, disabled, className }: EmojiPickerProps) {
    const [active, setActive] = useState(CATEGORIES[0].id);
    const current = CATEGORIES.find((c) => c.id === active) || CATEGORIES[0];

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button type="button" size="sm" variant="outline" disabled={disabled} className={className} aria-label="Inserir emoji">
                    <Smile /> Emoji
                </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[19rem] p-0">
                <div className="flex border-b border-border">
                    {CATEGORIES.map((c) => (
                        <button
                            key={c.id}
                            type="button"
                            title={c.label}
                            aria-label={c.label}
                            onClick={() => setActive(c.id)}
                            className={cn(
                                "flex-1 py-2 text-lg transition-colors hover:bg-muted",
                                active === c.id && "bg-muted shadow-[inset_0_-3px_0_var(--brand)]"
                            )}
                        >
                            {c.icon}
                        </button>
                    ))}
                </div>
                <p className="kicker px-3 pt-3">{current.label}</p>
                <div className="grid max-h-56 grid-cols-8 gap-0.5 overflow-y-auto p-2">
                    {current.emojis.map((e) => (
                        <button
                            key={e}
                            type="button"
                            onClick={() => onPick(e)}
                            className="flex h-9 w-9 items-center justify-center rounded-[10px] text-xl transition-colors hover:bg-muted"
                        >
                            {e}
                        </button>
                    ))}
                </div>
            </PopoverContent>
        </Popover>
    );
}
