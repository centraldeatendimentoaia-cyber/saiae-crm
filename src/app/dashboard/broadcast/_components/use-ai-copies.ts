import { useState } from "react";
import { toast } from "sonner";

// Geração de textos com IA para o disparo (/api/ai/copy)
export function useAiCopies() {
    const [objective, setObjective] = useState("");
    const [loading, setLoading] = useState(false);
    const [copies, setCopies] = useState<string[]>([]);

    const generate = async () => {
        if (objective.trim().length < 3) {
            toast.error("Descreva o que você quer comunicar");
            return;
        }
        setLoading(true);
        setCopies([]);
        try {
            const res = await fetch("/api/ai/copy", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ objective }),
            });
            const data = await res.json();
            if (!res.ok || !data.status) throw new Error(data.error || "Falha ao gerar o texto");
            setCopies(data.copies);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Falha ao gerar o texto");
        } finally {
            setLoading(false);
        }
    };

    return { objective, setObjective, loading, copies, generate };
}
