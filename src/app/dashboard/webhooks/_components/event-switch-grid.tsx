"use client";

import { Switch } from "@/components/ui/switch";
import { AVAILABLE_EVENTS } from "./types";

export function EventSwitchGrid({ events, onChange, className }: {
    events: string[];
    onChange: (events: string[]) => void;
    className: string;
}) {
    return (
        <div className={className}>
            {AVAILABLE_EVENTS.map(event => (
                <div key={event.id} className="flex items-center gap-2 p-2 rounded border">
                    <Switch
                        checked={events.includes(event.id)}
                        onCheckedChange={(checked) => {
                            if (checked) onChange([...events, event.id]);
                            else onChange(events.filter(e => e !== event.id));
                        }}
                    />
                    <div>
                        <p className="text-sm font-medium">{event.label}</p>
                        <p className="text-xs text-muted-foreground">{event.description}</p>
                    </div>
                </div>
            ))}
        </div>
    );
}
