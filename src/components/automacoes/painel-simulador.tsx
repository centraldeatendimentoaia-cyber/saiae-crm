"use client";

import { useState } from "react";
import { Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { simularFluxo, type ResultadoSimulacao } from "@/modules/automacoes/editor/simulador";
import type { Definicao, Valor } from "@/modules/automacoes/tipos";
import { formatarEspera } from "./no-fluxo";

/** "chave=valor" por linha; números e true/false viram o tipo correspondente (a condição não coage tipos). */
function lerVariaveis(texto: string): Record<string, Valor> {
    const v: Record<string, Valor> = {};
    for (const linha of texto.split("\n")) {
        const i = linha.indexOf("=");
        if (i <= 0) continue;
        const k = linha.slice(0, i).trim(), s = linha.slice(i + 1).trim();
        v[k] = s === "true" ? true : s === "false" ? false : s !== "" && Number.isFinite(Number(s)) ? Number(s) : s;
    }
    return v;
}

const STATUS: Record<ResultadoSimulacao["status"], string> = {
    completed: "Concluído", failed: "Falhou", cancelled: "Cancelado", waiting: "Esperando", limite_de_simulacao: "Parou no limite da simulação (loop com espera)", invalida: "Fluxo inválido: nada foi executado",
};

export function PainelSimulador({ definicao }: { definicao: Definicao }) {
    const [vars, setVars] = useState("nome=Maria");
    const [janela, setJanela] = useState(true);
    const [rodando, setRodando] = useState(false);
    const [r, setR] = useState<ResultadoSimulacao | null>(null);

    const rodar = async () => {
        setRodando(true);
        try { setR(await simularFluxo(definicao, { variaveis: lerVariaveis(vars), janelaAberta: janela })); } finally { setRodando(false); }
    };

    return (
        <section aria-label="Simulador" className="space-y-2">
            <h2 className="text-sm font-bold">Simulador</h2>
            <p className="text-xs text-muted-foreground">Roda o fluxo na memória, com relógio fictício. Nada é enviado, gravado nem consultado.</p>
            <div className="space-y-1.5">
                <Label htmlFor="sim-vars">Variáveis iniciais (chave=valor, uma por linha)</Label>
                <textarea id="sim-vars" rows={3} value={vars} onChange={(e) => setVars(e.target.value)} className="w-full rounded-[10px] border border-input bg-card px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-mustard-300" />
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={janela} onChange={(e) => setJanela(e.target.checked)} /> Janela de 24 h aberta (texto livre permitido)</label>
            <Button size="sm" onClick={rodar} disabled={rodando}>{rodando ? <Loader2 className="animate-spin" aria-hidden /> : <Play aria-hidden />} Simular</Button>

            <div aria-live="polite">
                {r && (
                    <div className="space-y-2 text-sm">
                        <p className="font-semibold">{STATUS[r.status]}{r.motivo ? `: ${r.motivo}` : ""}</p>
                        {r.erros.length > 0 && <ul className="list-disc pl-5 text-destructive">{r.erros.map((m) => <li key={m}>{m}</li>)}</ul>}
                        {r.caminho.length > 0 && <div><h3 className="font-semibold">Caminho percorrido</h3><ol className="list-decimal pl-5">{r.caminho.map((p) => <li key={p.seq}>{p.nodeId} ({p.tipo}) em +{p.emMs === 0 ? "0 s" : formatarEspera(p.emMs)}</li>)}</ol></div>}
                        {r.mensagens.length > 0 && <div><h3 className="font-semibold">Mensagens que SERIAM enviadas</h3><ul className="space-y-1">{r.mensagens.map((m, i) => <li key={i} className="rounded-lg bg-muted p-2"><span className="text-xs text-muted-foreground">{m.nodeId} · {m.tipo}</span><br />{m.conteudo}{m.params?.length ? ` (${m.params.join(", ")})` : ""}</li>)}</ul></div>}
                        {r.esperas.length > 0 && <p>Tempo avançado nas esperas: {r.esperas.map((e) => `${e.nodeId} ${formatarEspera(e.ms)}`).join(", ")} (total simulado {r.duracaoMs === 0 ? "0 s" : formatarEspera(r.duracaoMs)}).</p>}
                        {r.etiquetas.length > 0 && <p>Etiquetas aplicadas: {r.etiquetas.join(", ")}.</p>}
                        {r.transferiuHumano && <p>Conversa transferida para humano.</p>}
                        <div><h3 className="font-semibold">Variáveis ao final</h3><pre className="overflow-x-auto rounded-lg bg-muted p-2 text-xs">{JSON.stringify(r.variaveis, null, 2)}</pre></div>
                    </div>
                )}
            </div>
        </section>
    );
}
