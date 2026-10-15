"use client";

import { TZ_SAO_PAULO } from "@/modules/atendimento-comum/tempo";
import { useEffect, useState } from "react";
import moment from "moment-timezone";
import { Clock } from "lucide-react";

export function RealtimeClock() {
    const [time, setTime] = useState("");
    const [timezone, setTimezone] = useState(TZ_SAO_PAULO);
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
        // Fetch global timezone
        fetch('/api/settings/system')
            .then(r => r.json())
            .then(data => {
                if (data && data.data && data.data.timezone) {
                    setTimezone(data.data.timezone);
                }
            })
            .catch(() => { });
    }, []);

    useEffect(() => {
        if (!mounted) return;

        const updateTime = () => {
            setTime(moment().tz(timezone).format("HH:mm:ss"));
        };

        updateTime();
        const interval = setInterval(updateTime, 1000);
        return () => clearInterval(interval);
    }, [timezone, mounted]);

    if (!mounted) return null;

    return (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-100 rounded-md border border-zinc-200 text-sm font-medium text-zinc-700">
            <Clock className="h-4 w-4 text-zinc-500" />
            <span>{time}</span>
            <span className="text-xs text-zinc-400 border-l border-zinc-300 pl-2 ml-1">{timezone}</span>
        </div>
    );
}
