/* eslint-disable @next/next/no-img-element */
import { cn } from "@/lib/utils";

interface BrandLogoProps {
    className?: string;
    /**
     * "auto" (padrão): logo com balão, troca sozinha entre tema claro e escuro.
     * "dark": logo horizontal para superfícies sempre escuras (menu lateral).
     */
    tone?: "auto" | "dark";
}

/** Logo Saiaê (Design System v1.0). "sai" e "aê" sempre com cor ou peso diferentes. */
export function BrandLogo({ className, tone = "auto" }: BrandLogoProps) {
    if (tone === "dark") {
        return <img src="/brand/saiae-texto-escuro.svg" alt="saiaê" className={cn("block w-auto", className)} />;
    }
    return (
        <>
            <img src="/brand/saiae-cheio-claro.svg" alt="saiaê" className={cn("block dark:hidden w-auto", className)} />
            <img src="/brand/saiae-cheio.svg" alt="saiaê" className={cn("hidden dark:block w-auto", className)} />
        </>
    );
}
