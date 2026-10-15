"use client";

import { Button } from "@/components/ui/button";
import { RefreshCw, Save } from "lucide-react";

export function SaveButton({ loading, disabled, onClick, children, className }: {
    loading: boolean;
    disabled: boolean;
    onClick: () => void;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <Button className={className} onClick={onClick} disabled={disabled}>
            {loading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            {children}
        </Button>
    );
}
