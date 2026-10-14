import { redirect } from "next/navigation";

// A tela única virou a seção Redes Sociais (calendário, rascunhos, histórico e contas).
export default function SocialRedirect() {
    redirect("/dashboard/redes-sociais/calendario");
}
