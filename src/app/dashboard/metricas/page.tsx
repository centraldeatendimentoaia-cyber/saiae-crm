"use client";

import { errorMessage } from "@/lib/errors";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useSession } from "@/components/dashboard/session-provider";
import { SessionGuard } from "@/components/dashboard/session-guard";
import type { RelatorioMetricas } from "@/modules/metricas/calcular";
import { dataBr, formatarDuracao, percentual, periodoAnterior, ultimosDias, variacao } from "@/modules/metricas/formato";

type Atalho = "7" | "30" | "personalizado";
interface Periodo { de: string; ate: string }
interface Resultado { rotulo: string; periodo: Periodo; dados: RelatorioMetricas }

const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const ORDEM_DIAS = [1, 2, 3, 4, 5, 6, 0]; // a semana começa na segunda

async function buscar(sessionId: string, p: Periodo): Promise<RelatorioMetricas> {
    const res = await fetch(`/api/metricas/${encodeURIComponent(sessionId)}?de=${p.de}&ate=${p.ate}`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.status) throw new Error(json.message || "Não foi possível carregar as métricas.");
    return json.data as RelatorioMetricas;
}

const urlCsv = (sessionId: string, p: Periodo) => `/api/metricas/${encodeURIComponent(sessionId)}?de=${p.de}&ate=${p.ate}&formato=csv`;

/** Quando `menorMelhor`, queda é boa (verde); sem isso a variação é neutra (só informa). */
function Variacao({ atual, anterior, menorMelhor, unidade }: { atual: number | null; anterior: number | null; menorMelhor?: boolean; unidade?: "pp" | "s" }) {
    const v = variacao(atual, anterior);
    if (!v) return null;
    if (v.sentido === "igual") return <span className="text-xs text-muted-foreground">sem mudança</span>;
    const sinal = v.diferenca > 0 ? "+" : "−";
    const abs = Math.abs(v.diferenca);
    const texto = unidade === "s" ? `${sinal}${formatarDuracao(abs)}` : unidade === "pp" ? `${sinal}${abs} p.p.` : v.percentual !== null ? `${sinal}${Math.abs(v.percentual)}%` : `${sinal}${abs}`;
    const cor = menorMelhor === undefined ? "text-muted-foreground" : (v.sentido === "caiu") === menorMelhor ? "text-green-600" : "text-red-600";
    return <span className={`text-xs font-medium ${cor}`}>{texto} vs. período A</span>;
}

function Cartao({ titulo, valor, detalhe, children }: { titulo: string; valor: string; detalhe?: string; children?: React.ReactNode }) {
    return (
        <Card>
            <CardHeader className="pb-2">
                <CardDescription>{titulo}</CardDescription>
                <CardTitle className="text-2xl sm:text-3xl">{valor}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 pt-0">
                {detalhe && <p className="text-xs text-muted-foreground">{detalhe}</p>}
                {children}
            </CardContent>
        </Card>
    );
}

function MapaDeCalor({ matriz }: { matriz: number[][] }) {
    const max = Math.max(1, ...matriz.flat());
    return (
        <div className="overflow-x-auto">
            <div className="min-w-[640px] space-y-1" role="img" aria-label="Mapa de calor das mensagens recebidas por dia da semana e hora">
                <div className="grid gap-1" style={{ gridTemplateColumns: "40px repeat(24, minmax(0, 1fr))" }}>
                    <span />
                    {Array.from({ length: 24 }, (_, h) => (
                        <span key={h} className="text-center text-[10px] text-muted-foreground">{h}</span>
                    ))}
                </div>
                {ORDEM_DIAS.map((d) => (
                    <div key={d} className="grid gap-1" style={{ gridTemplateColumns: "40px repeat(24, minmax(0, 1fr))" }}>
                        <span className="self-center text-xs text-muted-foreground">{DIAS_SEMANA[d]}</span>
                        {matriz[d].map((n, h) => (
                            <div
                                key={h}
                                title={`${DIAS_SEMANA[d]}, ${h}h: ${n} ${n === 1 ? "mensagem recebida" : "mensagens recebidas"}`}
                                className="h-6 rounded-sm bg-green-600"
                                style={{ opacity: n === 0 ? 0.07 : 0.2 + 0.8 * (n / max) }}
                            />
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
}

function GraficoDiario({ serie }: { serie: RelatorioMetricas["porDia"] }) {
    const max = Math.max(1, ...serie.map((d) => d.recebidas));
    return (
        <div className="overflow-x-auto">
            <div className="flex h-40 items-end gap-1" style={{ minWidth: Math.max(serie.length * 14, 280) }} role="img" aria-label="Mensagens recebidas por dia">
                {serie.map((d) => (
                    <div
                        key={d.dia}
                        className="flex h-full flex-1 flex-col justify-end"
                        title={`${dataBr(d.dia)}: ${d.recebidas} recebidas, ${d.demandas} demandas, ${d.semRetorno} sem retorno, 1ª resposta ${formatarDuracao(d.tempoMediano)}`}
                    >
                        <div className="w-full rounded-t-sm bg-green-600" style={{ height: `${(d.recebidas / max) * 100}%`, minHeight: d.recebidas ? 2 : 0 }} />
                    </div>
                ))}
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                <span>{dataBr(serie[0].dia)}</span>
                <span>{dataBr(serie[serie.length - 1].dia)}</span>
            </div>
        </div>
    );
}

export default function MetricasPage() {
    const { sessionId } = useSession();
    const hoje7 = useMemo(() => ultimosDias(7), []);
    const [comparar, setComparar] = useState(false);
    const [atalho, setAtalho] = useState<Atalho>("7");
    const [periodoB, setPeriodoB] = useState<Periodo>(hoje7);
    const [periodoA, setPeriodoA] = useState<Periodo>(() => periodoAnterior(hoje7.de, hoje7.ate));
    const [loading, setLoading] = useState(false);
    const [resultados, setResultados] = useState<Resultado[]>([]);
    const [erro, setErro] = useState<string | null>(null);

    const escolherAtalho = (a: Atalho) => {
        setAtalho(a);
        if (a !== "personalizado") {
            const p = ultimosDias(Number(a));
            setPeriodoB(p);
            setPeriodoA(periodoAnterior(p.de, p.ate));
        }
    };

    const carregar = useCallback(async () => {
        if (!sessionId) return;
        setLoading(true);
        setErro(null);
        try {
            if (comparar) {
                const [a, b] = await Promise.all([buscar(sessionId, periodoA), buscar(sessionId, periodoB)]);
                setResultados([
                    { rotulo: "Período A (antes)", periodo: periodoA, dados: a },
                    { rotulo: "Período B (depois)", periodo: periodoB, dados: b },
                ]);
            } else {
                setResultados([{ rotulo: "Período", periodo: periodoB, dados: await buscar(sessionId, periodoB) }]);
            }
        } catch (e) {
            const msg = errorMessage(e, "Não foi possível carregar as métricas.");
            setErro(msg);
            setResultados([]);
            toast.error(msg);
        } finally {
            setLoading(false);
        }
    }, [sessionId, comparar, periodoA, periodoB]);

    useEffect(() => {
        const datasOk = (p: Periodo) => /^\d{4}-\d{2}-\d{2}$/.test(p.de) && /^\d{4}-\d{2}-\d{2}$/.test(p.ate) && p.de <= p.ate;
        if (datasOk(periodoB) && (!comparar || datasOk(periodoA))) void carregar();
    }, [carregar, comparar, periodoA, periodoB]);

    const principal = resultados[resultados.length - 1]?.dados;
    const base = comparar && resultados.length === 2 ? resultados[0].dados : null;

    const resumo = (d: RelatorioMetricas) => ({
        foraPct: percentual(d.demandasForaExpediente, d.demandas),
        semRetornoPct: percentual(d.demandasSemRetorno, d.demandas),
        mediana: d.tempoPrimeiraResposta.geral.mediana,
        ia: d.respostasPorOrigem.ia,
        humano: d.respostasPorOrigem.humano,
        outras: d.respostasPorOrigem.crm + d.respostasPorOrigem.desconhecido,
    });
    const p = principal ? resumo(principal) : null;
    const b = base ? resumo(base) : null;

    const campoPeriodo = (rotulo: string, valor: Periodo, set: (p: Periodo) => void, id: string) => (
        <div className="space-y-1">
            <p className="text-sm font-medium">{rotulo}</p>
            <div className="flex flex-wrap items-end gap-2">
                <div>
                    <Label htmlFor={`${id}-de`} className="text-xs text-muted-foreground">De</Label>
                    <Input id={`${id}-de`} type="date" value={valor.de} max={valor.ate || undefined} onChange={(e) => { setAtalho("personalizado"); set({ ...valor, de: e.target.value }); }} />
                </div>
                <div>
                    <Label htmlFor={`${id}-ate`} className="text-xs text-muted-foreground">Até</Label>
                    <Input id={`${id}-ate`} type="date" value={valor.ate} min={valor.de || undefined} onChange={(e) => { setAtalho("personalizado"); set({ ...valor, ate: e.target.value }); }} />
                </div>
            </div>
        </div>
    );

    return (
        <SessionGuard>
            <div className="space-y-6">
                <div>
                    <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-3xl"><BarChart3 className="h-6 w-6 sm:h-8 sm:w-8" />Métricas de atendimento</h2>
                    <p className="text-muted-foreground">
                        Quantas pessoas escreveram, quanto tempo levou a primeira resposta e quantas ficaram sem retorno. Os horários seguem o expediente configurado em Agente do salão (sem configuração: segunda a sexta, das 9h às 18h).
                    </p>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle>Período</CardTitle>
                        <CardDescription>Até 92 dias. Datas no horário de Brasília.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex flex-wrap gap-2">
                            <Button variant={atalho === "7" ? "default" : "outline"} size="sm" onClick={() => escolherAtalho("7")}>Últimos 7 dias</Button>
                            <Button variant={atalho === "30" ? "default" : "outline"} size="sm" onClick={() => escolherAtalho("30")}>Últimos 30 dias</Button>
                            <Button variant={atalho === "personalizado" ? "default" : "outline"} size="sm" onClick={() => setAtalho("personalizado")}>Personalizado</Button>
                            <Button variant={comparar ? "default" : "outline"} size="sm" onClick={() => setComparar((c) => !c)} aria-pressed={comparar}>
                                Comparar antes x depois
                            </Button>
                        </div>
                        <div className="flex flex-wrap gap-6">
                            {comparar && campoPeriodo("Período A (antes)", periodoA, setPeriodoA, "a")}
                            {(atalho === "personalizado" || comparar) && campoPeriodo(comparar ? "Período B (depois)" : "Datas", periodoB, setPeriodoB, "b")}
                        </div>
                    </CardContent>
                </Card>

                {loading && resultados.length === 0 && <p className="text-sm text-muted-foreground">Carregando métricas...</p>}
                {erro && !loading && <p className="text-sm text-red-600">{erro}</p>}

                {principal && p && principal.mensagensRecebidas === 0 && principal.mensagensEnviadas === 0 && (
                    <Card>
                        <CardContent className="py-8 text-center text-sm text-muted-foreground">
                            Nenhuma mensagem neste período. Escolha outras datas ou confira se o número está conectado em Sessões / QR.
                        </CardContent>
                    </Card>
                )}

                {principal && p && (principal.mensagensRecebidas > 0 || principal.mensagensEnviadas > 0) && (
                    <div className={`space-y-6 ${loading ? "opacity-60" : ""}`}>
                        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                            <Cartao titulo="Mensagens recebidas" valor={String(principal.mensagensRecebidas)} detalhe={`${principal.contatosUnicos} contatos, ${principal.contatosNovos} novos`}>
                                {base && <Variacao atual={principal.mensagensRecebidas} anterior={base.mensagensRecebidas} />}
                            </Cartao>
                            <Cartao titulo="Demandas (pessoas que pediram atendimento)" valor={String(principal.demandas)} detalhe="Várias mensagens seguidas contam como uma demanda">
                                {base && <Variacao atual={principal.demandas} anterior={base.demandas} />}
                            </Cartao>
                            <Cartao titulo="Fora do expediente" valor={p.foraPct === null ? "—" : `${p.foraPct}%`} detalhe={`${principal.demandasForaExpediente} de ${principal.demandas} demandas`}>
                                {b && <Variacao atual={p.foraPct} anterior={b.foraPct} unidade="pp" />}
                            </Cartao>
                            <Cartao
                                titulo="Sem retorno"
                                valor={p.semRetornoPct === null ? "—" : `${p.semRetornoPct}%`}
                                detalhe={`${principal.demandasSemRetorno} sem resposta em 24 h${principal.demandasPendentes ? ` · ${principal.demandasPendentes} ainda dentro do prazo` : ""}`}
                            >
                                {b && <Variacao atual={p.semRetornoPct} anterior={b.semRetornoPct} menorMelhor unidade="pp" />}
                            </Cartao>
                            <Cartao
                                titulo="Tempo da 1ª resposta (mediana)"
                                valor={formatarDuracao(p.mediana)}
                                detalhe={`Dentro do expediente: ${formatarDuracao(principal.tempoPrimeiraResposta.dentroExpediente.mediana)} · Fora: ${formatarDuracao(principal.tempoPrimeiraResposta.foraExpediente.mediana)}`}
                            >
                                {b && <Variacao atual={p.mediana} anterior={b.mediana} menorMelhor unidade="s" />}
                                <p className="text-xs text-muted-foreground">90% das respostas em até {formatarDuracao(principal.tempoPrimeiraResposta.geral.p90)}</p>
                            </Cartao>
                            <Cartao
                                titulo="Quem respondeu primeiro"
                                valor={`${p.ia} IA · ${p.humano} pessoas`}
                                detalhe={p.outras ? `${p.outras} por disparo/agendador ou sem identificação` : "Pessoa = quem respondeu pelo celular ou WhatsApp Web"}
                            />
                        </div>

                        {resultados.map((r) => (
                            <div key={r.rotulo} className="space-y-4">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <h3 className="text-lg font-semibold">{r.rotulo}: {dataBr(r.periodo.de)} a {dataBr(r.periodo.ate)}</h3>
                                    {sessionId && (
                                        <Button asChild variant="outline" size="sm">
                                            <a href={urlCsv(sessionId, r.periodo)} download>
                                                <Download className="h-4 w-4" /> Exportar CSV
                                            </a>
                                        </Button>
                                    )}
                                </div>
                                <Card>
                                    <CardHeader>
                                        <CardTitle>Quando as pessoas escrevem</CardTitle>
                                        <CardDescription>Mensagens recebidas por dia da semana e hora. Quanto mais escuro, mais mensagens.</CardDescription>
                                    </CardHeader>
                                    <CardContent><MapaDeCalor matriz={r.dados.volumePorDiaHora} /></CardContent>
                                </Card>
                                <Card>
                                    <CardHeader>
                                        <CardTitle>Mensagens recebidas por dia</CardTitle>
                                        <CardDescription>Passe o mouse (ou toque) numa barra para ver demandas, sem retorno e tempo de resposta do dia.</CardDescription>
                                    </CardHeader>
                                    <CardContent><GraficoDiario serie={r.dados.porDia} /></CardContent>
                                </Card>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </SessionGuard>
    );
}
