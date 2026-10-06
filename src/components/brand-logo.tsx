/* eslint-disable @next/next/no-img-element */
import { cn } from "@/lib/utils";

interface BrandLogoProps {
    className?: string;
    /**
     * "auto" (padrão): logo com balão, troca sozinha entre tema claro e escuro.
     * "dark": logo horizontal para superfícies sempre escuras (menu lateral).
     */
    tone?: "auto" | "dark";
    /** Mostra a etiqueta "CRM" ao lado da logo (igual ao cabeçalho da página de vendas). */
    crm?: boolean;
}

/** Logo Saiaê (Design System v1.0). "sai" e "aê" sempre com cor ou peso diferentes. */
export function BrandLogo({ className, tone = "auto", crm = false }: BrandLogoProps) {
    const logo =
        tone === "dark" ? (
            <img src="/brand/saiae-texto-escuro.svg" alt="saiaê" className={cn("block w-auto", className)} />
        ) : (
            <>
                <img src="/brand/saiae-cheio-claro.svg" alt="saiaê" className={cn("block dark:hidden w-auto", className)} />
                <img src="/brand/saiae-cheio.svg" alt="saiaê" className={cn("hidden dark:block w-auto", className)} />
            </>
        );

    if (!crm) return logo;

    return (
        <span className="inline-flex items-center gap-3">
            {logo}
            <span
                className="rounded-[8px_8px_8px_2px] bg-foreground px-2.5 py-1 font-display text-[13px] font-extrabold tracking-[0.06em] text-brand dark:bg-brand dark:text-brand-foreground"
                aria-label="CRM"
            >
                CRM
            </span>
        </span>
    );
}
