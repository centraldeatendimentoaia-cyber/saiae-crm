import { redirect } from "next/navigation";

// O gerenciador de notificações virou a aba "Enviar" de /dashboard/notificacoes (só SUPERADMIN).
export default function NotificationsRedirect() {
    redirect("/dashboard/notificacoes?aba=enviar");
}
