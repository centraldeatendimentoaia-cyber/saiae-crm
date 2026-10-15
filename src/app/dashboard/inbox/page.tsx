import { redirect } from "next/navigation";

// A caixa de entrada virou a aba "Recebidas" de /dashboard/notificacoes. Mantém links e favoritos antigos funcionando.
export default function InboxRedirect() {
    redirect("/dashboard/notificacoes");
}
