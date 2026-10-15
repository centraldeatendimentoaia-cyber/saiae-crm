/**
 * Páginas do painel que só o SUPERADMIN pode abrir. Escondê-las no menu não basta: o src/proxy.ts usa esta lista
 * para barrar a navegação direta pela URL (as páginas são componentes de cliente, sem como checar no servidor).
 * Mantenha igual aos itens `superadminOnly` de components/dashboard/nav-items.ts (há teste que confere).
 * Arquivo sem imports de propósito: o proxy não deve carregar Prisma só por causa desta lista.
 */
export const PAGINAS_SO_SUPERADMIN = [
    "/dashboard/users",
    "/dashboard/system-monitor",
    "/dashboard/notifications",
    "/dashboard/atendente-ia",
    "/dashboard/agente-ia",
] as const;

export function paginaSoParaSuperadmin(pathname: string): boolean {
    return PAGINAS_SO_SUPERADMIN.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
