import { redirect } from "next/navigation";

// A documentação da API ficou só no Swagger UI (gerado da mesma spec). Mantém o link antigo funcionando.
export default function DocsRedirect() {
    redirect("/swagger");
}
