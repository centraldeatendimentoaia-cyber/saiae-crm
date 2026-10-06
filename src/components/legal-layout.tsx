import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";

export function LegalLayout({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
    return (
        <div className="min-h-screen bg-background">
            <header className="border-b border-border bg-card">
                <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
                    <Link href="/" aria-label="Sai aê CRM, página inicial">
                        <BrandLogo className="h-10" />
                    </Link>
                    <Link href="/auth/login" className="text-sm font-semibold underline underline-offset-4">Entrar</Link>
                </div>
            </header>
            <main className="mx-auto max-w-3xl px-4 py-12">
                <p className="kicker">Documento legal</p>
                <h1 className="mt-2 text-4xl font-extrabold">{title}</h1>
                <p className="mt-2 text-sm text-muted-foreground">Última atualização: {updated}</p>
                <div className="mt-10 space-y-8 text-[15px] leading-relaxed [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-bold [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5">
                    {children}
                </div>
            </main>
            <footer className="border-t border-border py-8 text-center text-sm text-muted-foreground">
                <Link href="/privacy" className="underline underline-offset-4">Privacidade</Link>
                {" · "}
                <Link href="/terms" className="underline underline-offset-4">Termos de uso</Link>
                {" · "}© {new Date().getFullYear()} Sai aê
            </footer>
        </div>
    );
}
