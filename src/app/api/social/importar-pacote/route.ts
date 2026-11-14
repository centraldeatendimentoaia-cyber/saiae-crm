import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { importarPacote, type ArquivoRecebido } from "@/modules/social/importar-pacote";

/**
 * POST /api/social/importar-pacote — importação idempotente de peças aprovadas da agência (contrato agencia-crm/1).
 * multipart: campo "manifesto" (JSON) + um arquivo por mídia, com o nome do campo igual a `midias[].ref` (ou `nome`).
 * JSON puro (sem arquivos) confere só contrato, contas e status: toda peça com mídia sai rejeitada por "arquivo ausente".
 * Para validar de verdade, envie multipart. Tudo entra como DRAFT; nada é agendado nem publicado.
 */
const MAX_CORPO = 60 * 1024 * 1024; // um pouco acima de MAX_LOTE_BYTES: sobra para o manifesto e o multipart

export async function POST(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });

    if (Number(request.headers.get("content-length") || 0) > MAX_CORPO) {
        return NextResponse.json({ status: false, codigo: "lote_grande", message: "Corpo acima de 60 MB: divida em lotes menores." }, { status: 413 });
    }
    let manifesto: unknown;
    const arquivos = new Map<string, ArquivoRecebido>();
    try {
        if ((request.headers.get("content-type") || "").includes("multipart/form-data")) {
            const form = await request.formData();
            manifesto = JSON.parse(String(form.get("manifesto") ?? ""));
            for (const [campo, v] of form.entries()) if (campo !== "manifesto" && typeof v !== "string") arquivos.set(campo, v as unknown as ArquivoRecebido);
        } else {
            manifesto = await request.json();
        }
    } catch {
        return NextResponse.json({ status: false, message: "Corpo inválido: envie multipart com o campo manifesto (JSON) ou JSON." }, { status: 400 });
    }

    const { http, ...resposta } = await importarPacote(user.id, manifesto, arquivos);
    return NextResponse.json(resposta, { status: http });
}
