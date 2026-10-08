"use client";

import { useEffect, useState } from "react";

let cached: Promise<boolean> | null = null;

/** Pergunta uma vez ao servidor se a cobrança está ligada (BILLING_ENFORCEMENT). Em erro, assume desligada. */
function load(): Promise<boolean> {
    if (!cached) {
        cached = fetch("/api/me/plan")
            .then((r) => r.json())
            .then((j) => !!(j?.status && j.data?.billingEnforced))
            .catch(() => false);
    }
    return cached;
}

/**
 * true = cobrança ligada; false = desligada; null = ainda carregando.
 * Telas de assinatura e avisos de trial só aparecem quando for `true`.
 */
export function useBillingEnforced(): boolean | null {
    const [value, setValue] = useState<boolean | null>(null);
    useEffect(() => {
        let alive = true;
        load().then((v) => alive && setValue(v));
        return () => {
            alive = false;
        };
    }, []);
    return value;
}
