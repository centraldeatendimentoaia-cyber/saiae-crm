import { auth } from "@/lib/auth";
import { NotificacoesAbas } from "@/components/notificacoes/notificacoes-abas";

// O papel é conferido aqui, no servidor: a aba "Enviar" nem chega ao navegador de quem não é SUPERADMIN.
// O POST em /api/notifications continua exigindo SUPERADMIN, então forjar a aba não adianta.
export default async function NotificacoesPage({
    searchParams,
}: {
    searchParams: Promise<{ aba?: string }>;
}) {
    const [session, { aba }] = await Promise.all([auth(), searchParams]);
    const podeEnviar = session?.user?.role === "SUPERADMIN";
    return <NotificacoesAbas podeEnviar={podeEnviar} abaInicial={aba === "enviar" ? "enviar" : "recebidas"} />;
}
