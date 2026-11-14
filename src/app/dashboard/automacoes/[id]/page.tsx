import { use } from "react";
import { EditorFluxo } from "@/components/automacoes/editor-fluxo";

export default function EditorPage({ params }: { params: Promise<{ id: string }> }) {
    return <EditorFluxo flowId={use(params).id} />;
}
