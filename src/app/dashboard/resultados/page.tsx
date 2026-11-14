"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Loader2, RefreshCw, Target, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useSession } from "@/components/dashboard/session-provider";
import { SessionGuard } from "@/components/dashboard/session-guard";
import { dataBr, ultimosDias } from "@/modules/metricas/formato";
import { ORIGENS, ROTULO_ORIGEM, ROTULO_TIPO, type Origem } from "@/modules/resultados/tipos";
import type { ContagemConfianca, Funil } from "@/modules/resultados/funil";

interface Periodo { de: string; ate: string }
interface ResumoImportacao { recebidas: number; validas: number; novos: number; repetidos: number; totalRejeitadas: number; rejeitadas: { linha: number; motivo: string }[] }

async function buscar(sessionId: string, p: Periodo, origem: string): Promise<Funil> {
    const extra = origem ? `&origem=${origem}` : "";
    const res = await fetch(`/api/resultados/${encodeURIComponent(sessionId)}?de=${p.de}&ate=${p.ate}${extra}`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.status) throw new Error(json.message || "Não foi possível carregar os resultados.");
    return json.data.funil as Funil;
}

/** Selo por número: texto e ícone, nunca só cor. Os três estados aparecem sempre separados. */
function Selos({ c }: { c: ContagemConfianca }) {
    return (
        <span className="flex flex-wrap gap-1 text-xs">
            <span className="rounded border px-1.5 py-0.5" title="Registro autoritativo (mensagem, importação)">✔ {c.confirmado} confirmado{c.confirmado === 1 ? "" : "s"}</span>
            <span className="rounded border border-dashed px-1.5 py-0.5" title="Derivado por regra; veja a nota de regras abaixo">≈ {c.inferido} inferido{c.inferido === 1 ? "" : "s"}</span>
            {c.desconhecido > 0 && <span className="rounded border px-1.5 py-0.5">? {c.desconhecido} desconhecido{c.desconhecido === 1 ? "" : "s"}</span>}
        </span>
    );
}

export default function ResultadosPage() {
    const { sessionId } = useSession();
    const [periodo, setPeriodo] = useState<Periodo>(() => ultimosDias(30));
    const [origem, setOrigem] = useState("");
    const [funil, setFunil] = useState<Funil | null>(null);
    const [erro, setErro] = useState<string | null>(null);
    const [carregando, setCarregando] = useState(false);
    const [formato, setFormato] = useState<"csv" | "json">("csv");
    const [conteudo, setConteudo] = useState("");
    const [importando, setImportando] = useState(false);
    const [resumo, setResumo] = useState<ResumoImportacao | null>(null);

    const carregar = useCallback(async () => {
        if (!sessionId) return;
        setCarregando(true);
        setErro(null);
        try {
            setFunil(await buscar(sessionId, periodo, origem));
        } catch (e) {
            setFunil(null);
            setErro(e instanceof Error ? e.message : "Não foi possível carregar os resultados.");
        } finally {
            setCarregando(false);
        }
    }, [sessionId, periodo, origem]);
    useEffect(() => { carregar(); }, [carregar]);

    const importar = async (e: React.FormEvent) => {
        e.preventDefault();
        setImportando(true);
        setResumo(null);
        try {
            const res = await fetch(`/api/resultados/${encodeURIComponent(sessionId)}/importar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ formato, conteudo }) });
            const json = await res.json().catch(() => ({}));
            if (!res.ok || !json.status) throw new Error(json.message || "Não foi possível importar.");
            setResumo(json.data);
            toast.success(`${json.data.novos} evento(s) novo(s) importado(s).`);
            carregar();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Não foi possível importar.");
        } finally {
            setImportando(false);
        }
    };
    const lerArquivo = async (f: File | undefined) => {
        if (!f) return;
        setFormato(f.name.toLowerCase().endsWith(".json") ? "json" : "csv");
        setConteudo(await f.text());
    };

    const vazio = funil !== null && funil.contatos === 0;
    const csvHref = `/api/resultados/${encodeURIComponent(sessionId)}?de=${periodo.de}&ate=${periodo.ate}${origem ? `&origem=${origem}` : ""}&formato=csv`;

    return (
        <SessionGuard>
            <div className="space-y-6">
                <div>
                    <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-3xl"><Target className="h-6 w-6 sm:h-8 sm:w-8" aria-hidden="true" />Resultados</h2>
                    <p className="text-muted-foreground">
                        Do lead à venda, por origem. Cada número mostra quantos casos são <strong>confirmados</strong> (registro autoritativo), <strong>inferidos</strong> (derivados por uma regra) e <strong>desconhecidos</strong>. A origem mostra de onde o contato aparentemente veio; não prova qual campanha causou a venda.
                    </p>
                </div>

                <Card>
                    <CardContent className="pt-6">
                        <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); carregar(); }}>
                            <div className="space-y-1"><Label htmlFor="res-de">De</Label><Input id="res-de" type="date" value={periodo.de} max={periodo.ate} onChange={(e) => setPeriodo({ ...periodo, de: e.target.value })} /></div>
                            <div className="space-y-1"><Label htmlFor="res-ate">Até</Label><Input id="res-ate" type="date" value={periodo.ate} min={periodo.de} onChange={(e) => setPeriodo({ ...periodo, ate: e.target.value })} /></div>
                            <div className="space-y-1">
                                <Label htmlFor="res-origem">Origem</Label>
                                <select id="res-origem" className="h-9 rounded-md border bg-background px-3 text-sm" value={origem} onChange={(e) => setOrigem(e.target.value)}>
                                    <option value="">Todas</option>
                                    {ORIGENS.map((o) => <option key={o} value={o}>{ROTULO_ORIGEM[o]}</option>)}
                                </select>
                            </div>
                            <Button type="submit" variant="outline" disabled={carregando}>{carregando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />}Atualizar</Button>
                            <Button asChild variant="outline"><a href={csvHref}><Download className="mr-2 h-4 w-4" aria-hidden="true" />Exportar CSV</a></Button>
                        </form>
                        <p className="mt-2 text-xs text-muted-foreground">Período máximo de 92 dias. Datas de São Paulo ({dataBr(periodo.de)} a {dataBr(periodo.ate)}).</p>
                    </CardContent>
                </Card>

                <div aria-live="polite">
                    {carregando && !funil && <p className="text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" aria-hidden="true" />Carregando os resultados...</p>}
                    {erro && (
                        <div role="alert" className="rounded-md border border-destructive p-4 text-sm">
                            <p className="font-medium">Erro: {erro}</p>
                            <Button variant="outline" size="sm" className="mt-2" onClick={carregar}>Tentar de novo</Button>
                        </div>
                    )}
                    {vazio && <p className="rounded-md border p-4 text-sm text-muted-foreground">Nenhum lead, conversa ou evento neste período{origem ? " e origem" : ""}. Ajuste o período ou importe a agenda abaixo.</p>}
                </div>

                {funil && !vazio && (
                    <Card>
                        <CardHeader>
                            <CardTitle>Funil do período</CardTitle>
                            <CardDescription>Pessoas distintas por etapa no período (não é coorte: um cliente antigo que volta conta em conversas, mas não em leads). Agendamentos, comparecimentos e vendas vêm só de importação e da atendente IA.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <p className="rounded-md border p-3 text-sm" role="status">
                                <strong>{funil.origemDesconhecida}</strong> contato(s) com <strong>origem não identificada</strong> (sem marcador de anúncio, etiqueta ou planilha). Eles entram nas contagens abaixo, na linha &quot;{ROTULO_ORIGEM.desconhecido}&quot;.
                            </p>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm">
                                    <caption className="sr-only">Funil de resultados por etapa e origem</caption>
                                    <thead>
                                        <tr className="border-b"><th scope="col" className="py-2 pr-4">Etapa</th><th scope="col" className="py-2 pr-4">Total no período</th><th scope="col" className="py-2">Por origem</th></tr>
                                    </thead>
                                    <tbody>
                                        {funil.linhas.map((l) => (
                                            <tr key={l.tipo} className="border-b align-top">
                                                <th scope="row" className="py-2 pr-4 font-medium">{ROTULO_TIPO[l.tipo]}</th>
                                                <td className="py-2 pr-4"><Selos c={l.contagem} /></td>
                                                <td className="py-2">
                                                    <ul className="space-y-1">
                                                        {(ORIGENS as readonly Origem[]).filter((o) => l.porOrigem[o].total > 0).map((o) => (
                                                            <li key={o} className="flex flex-wrap items-center gap-2"><span className="w-44 shrink-0">{ROTULO_ORIGEM[o]}</span><Selos c={l.porOrigem[o]} /></li>
                                                        ))}
                                                        {l.contagem.total === 0 && <li className="text-muted-foreground">Sem registros</li>}
                                                    </ul>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <details className="text-sm">
                                <summary className="cursor-pointer font-medium">Regras de inferência</summary>
                                <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                                    <li>Anúncio confirmado: a primeira mensagem trouxe o marcador de clique para WhatsApp. A campanha específica continua desconhecida.</li>
                                    <li>Orgânico inferido: a primeira mensagem não trouxe marcador de anúncio (pode ser indicação, post ou anúncio sem rastreio).</li>
                                    <li>Origem por etiqueta ou planilha: inferida, pois não é verificada pelo sistema.</li>
                                    <li>Venda registrada pela atendente IA: inferida, sem conferência com caixa ou agenda.</li>
                                    <li>Lead: primeira mensagem recebida registrada. Se o histórico antigo foi apagado, um cliente antigo pode aparecer como lead.</li>
                                </ul>
                            </details>
                        </CardContent>
                    </Card>
                )}

                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2"><Upload className="h-5 w-5" aria-hidden="true" />Importar agenda e vendas</CardTitle>
                        <CardDescription>Arquivo CSV (separado por ; ou ,) ou JSON exportado da sua agenda. Colunas: tipo (agendamento_solicitado, agendamento_confirmado, comparecimento, venda), contato (telefone com DDD), ocorrido_em (AAAA-MM-DD), origem, campanha, referencia, valor. Repetir o mesmo arquivo não duplica. Só o dono da sessão importa.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form className="space-y-3" onSubmit={importar}>
                            <div className="space-y-1"><Label htmlFor="res-arquivo">Arquivo</Label><Input id="res-arquivo" type="file" accept=".csv,.json,text/csv,application/json" onChange={(e) => lerArquivo(e.target.files?.[0])} /></div>
                            <div className="space-y-1"><Label htmlFor="res-conteudo">Ou cole o conteúdo ({formato.toUpperCase()})</Label><Textarea id="res-conteudo" rows={6} value={conteudo} onChange={(e) => setConteudo(e.target.value)} className="font-mono text-xs" /></div>
                            <Button type="submit" disabled={importando || !conteudo.trim()}>{importando && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}Importar</Button>
                        </form>
                        <div aria-live="polite" className="mt-3 text-sm">
                            {resumo && (
                                <div className="rounded-md border p-3">
                                    <p>{resumo.recebidas} linha(s) lida(s): {resumo.novos} nova(s), {resumo.repetidos} já importada(s), {resumo.totalRejeitadas} rejeitada(s).</p>
                                    {resumo.rejeitadas.length > 0 && <ul className="mt-2 list-disc pl-5 text-muted-foreground">{resumo.rejeitadas.map((r) => <li key={r.linha}>Linha {r.linha}: {r.motivo}</li>)}</ul>}
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </SessionGuard>
    );
}
