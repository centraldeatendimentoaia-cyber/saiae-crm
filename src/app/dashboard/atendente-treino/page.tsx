"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GraduationCap, Rocket, Save } from "lucide-react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import { podeSalvar } from "@/lib/sessao-segura";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useSession } from "@/components/dashboard/session-provider";
import { SessionGuard } from "@/components/dashboard/session-guard";
import { ChatTeste } from "@/components/atendente/chat-teste";
import {
    SecaoBase, SecaoExemplos, SecaoFollowUp, SecaoGatilhos, SecaoIdentidade, SecaoObjecoes, SecaoRoteiro, SecaoVocabulario,
} from "@/components/atendente/secoes";
import { MODELOS } from "@/modules/atendente/modelos-prontos";
import { temAlteracoes, validarTreino } from "@/modules/atendente/editor";
import type { Treino } from "@/modules/atendente/treino";

type ChaveModelo = keyof typeof MODELOS;
const NOMES_MODELO: Record<ChaveModelo, string> = { salao: "Salão de beleza", clinica: "Clínica", agencia: "Agência", branco: "Em branco" };
interface Versao { versao: number; criadoEm: string }
type Confirmar = { tipo: "modelo"; chave: ChaveModelo } | { tipo: "versao"; versao: number } | null;

const copia = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

async function chamar(url: string, metodo: "GET" | "PUT" | "POST", corpo?: unknown) {
    const res = await fetch(url, { method: metodo, headers: { "Content-Type": "application/json" }, ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}) });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j?.status) throw new Error(j?.message || "Não foi possível concluir. Tente de novo.");
    return j.data;
}

export default function AtendenteTreinoPage() {
    const { sessionId } = useSession();
    const [treino, setTreino] = useState<Treino | null>(null);
    const [salvo, setSalvo] = useState<Treino | null>(null); // o que está gravado no servidor (null = ainda sem rascunho)
    const [dadosSessionId, setDadosSessionId] = useState<string | null>(null);
    const [versoes, setVersoes] = useState<Versao[]>([]);
    const [publicadoVersao, setPublicadoVersao] = useState<number | null>(null);
    const [erroCarga, setErroCarga] = useState(false);
    const [ocupado, setOcupado] = useState(false);
    const [modelo, setModelo] = useState<ChaveModelo | "">("");
    const [confirmar, setConfirmar] = useState<Confirmar>(null);
    const [erroValidacao, setErroValidacao] = useState<string | null>(null);
    const requisicao = useRef(0); // descarta respostas de uma sessão que já foi trocada

    const carregar = useCallback(async () => {
        if (!sessionId) return;
        const minha = ++requisicao.current;
        try {
            const d = await chamar(`/api/atendente/${sessionId}/treino`, "GET");
            if (minha !== requisicao.current) return;
            setErroCarga(false);
            setSalvo(d.rascunho ?? null);
            setTreino(d.rascunho ? copia(d.rascunho as Treino) : copia(MODELOS.branco));
            setVersoes(d.versoes ?? []);
            setPublicadoVersao(d.publicadoVersao ?? null);
            setDadosSessionId(sessionId);
        } catch (e) {
            if (minha !== requisicao.current) return;
            setErroCarga(true);
            toast.error(errorMessage(e, "Falha ao carregar o treino"));
        }
    }, [sessionId]);

    // Trocou de sessão: zera tudo para nunca salvar o treino de uma sessão em outra.
    useEffect(() => {
        requisicao.current++;
        setTreino(null);
        setSalvo(null);
        setDadosSessionId(null);
        setVersoes([]);
        setPublicadoVersao(null);
        setErroCarga(false);
        setErroValidacao(null);
        setModelo("");
        setConfirmar(null);
        setOcupado(false);
        carregar();
    }, [carregar]);

    const alterado = temAlteracoes(treino, salvo);
    const liberado = !!treino && podeSalvar(sessionId, dadosSessionId, ocupado);

    /** Salva o rascunho; devolve true se gravou. */
    const salvar = async (): Promise<boolean> => {
        if (!treino || !liberado) return false;
        const problema = validarTreino(treino);
        setErroValidacao(problema);
        if (problema) {
            toast.error(problema);
            return false;
        }
        const minha = requisicao.current;
        setOcupado(true);
        try {
            await chamar(`/api/atendente/${sessionId}/treino`, "PUT", treino);
            if (minha !== requisicao.current) return false;
            setSalvo(copia(treino));
            toast.success("Rascunho salvo.");
            return true;
        } catch (e) {
            if (minha === requisicao.current) {
                setErroValidacao(errorMessage(e, ""));
                toast.error(errorMessage(e, "Falha ao salvar"));
            }
            return false;
        } finally {
            if (minha === requisicao.current) setOcupado(false);
        }
    };

    const publicar = async () => {
        if (!treino || !liberado) return;
        if (alterado && !(await salvar())) return;
        const minha = requisicao.current;
        setOcupado(true);
        try {
            const d = await chamar(`/api/atendente/${sessionId}/publicar`, "POST");
            if (minha !== requisicao.current) return;
            toast.success(`Versão ${d.versao} publicada.`);
            await carregar();
        } catch (e) {
            if (minha === requisicao.current) toast.error(errorMessage(e, "Falha ao publicar"));
        } finally {
            if (minha === requisicao.current) setOcupado(false);
        }
    };

    const reverter = async (versao: number) => {
        if (!liberado) return;
        const minha = requisicao.current;
        setOcupado(true);
        try {
            await chamar(`/api/atendente/${sessionId}/reverter`, "POST", { versao });
            if (minha !== requisicao.current) return;
            toast.success(`Voltou para a versão ${versao}.`);
            await carregar();
        } catch (e) {
            if (minha === requisicao.current) toast.error(errorMessage(e, "Falha ao voltar de versão"));
        } finally {
            if (minha === requisicao.current) setOcupado(false);
        }
    };

    const aplicarConfirmacao = () => {
        if (confirmar?.tipo === "modelo") {
            setTreino(copia(MODELOS[confirmar.chave]));
            setErroValidacao(null);
            toast.success("Modelo aplicado ao rascunho. Revise e salve.");
        } else if (confirmar?.tipo === "versao") {
            reverter(confirmar.versao);
        }
        setModelo("");
        setConfirmar(null);
    };

    const secaoProps = treino ? { t: treino, onChange: (t: Treino) => { setTreino(t); setErroValidacao(null); }, disabled: ocupado } : null;

    return (
        <SessionGuard>
            <div className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-3xl"><GraduationCap className="h-7 w-7" />Treinar atendente</h2>
                        <p className="text-sm text-muted-foreground">Escreva o treino, teste com o chat ao lado e publique. A atendente só passa a usar o treino depois de publicado.</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        {alterado && <span className="text-sm text-amber-600" role="status">Alterações não salvas</span>}
                        <Button variant="outline" onClick={salvar} disabled={!liberado || !alterado}><Save className="mr-1 h-4 w-4" />Salvar rascunho</Button>
                        <Button onClick={publicar} disabled={!liberado || (!alterado && salvo === null)}><Rocket className="mr-1 h-4 w-4" />Publicar</Button>
                    </div>
                </div>

                {!treino || !secaoProps ? (
                    <p className="text-sm text-muted-foreground">{erroCarga ? "Não foi possível carregar o treino desta sessão. Recarregue a página." : "Carregando..."}</p>
                ) : (
                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
                        <div className="min-w-0 space-y-4">
                            {salvo === null && <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">Esta sessão ainda não tem rascunho. Escolha um modelo pronto ou preencha do zero e salve.</p>}
                            {erroValidacao && <p className="rounded-lg border border-destructive/50 p-3 text-sm text-destructive" role="alert">{erroValidacao}</p>}

                            <Card>
                                <CardHeader>
                                    <CardTitle>Modelo pronto</CardTitle>
                                    <CardDescription>Preenche o rascunho com um ponto de partida. Nada é publicado sozinho.</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <select
                                        className="h-9 w-full rounded-md border bg-background px-3 text-sm sm:max-w-xs"
                                        aria-label="Modelo pronto"
                                        value={modelo}
                                        disabled={ocupado}
                                        onChange={(e) => { const chave = e.target.value as ChaveModelo; setModelo(chave); if (chave) setConfirmar({ tipo: "modelo", chave }); }}
                                    >
                                        <option value="">Escolher um modelo...</option>
                                        {(Object.keys(MODELOS) as ChaveModelo[]).map((k) => <option key={k} value={k}>{NOMES_MODELO[k]}</option>)}
                                    </select>
                                </CardContent>
                            </Card>

                            <SecaoIdentidade {...secaoProps} />
                            <SecaoBase {...secaoProps} />
                            <SecaoRoteiro {...secaoProps} />
                            <SecaoGatilhos {...secaoProps} />
                            <SecaoObjecoes {...secaoProps} />
                            <SecaoExemplos {...secaoProps} />
                            <SecaoFollowUp {...secaoProps} />
                            <SecaoVocabulario {...secaoProps} />
                        </div>

                        <aside className="min-w-0 space-y-4 lg:sticky lg:top-4 lg:self-start">
                            <ChatTeste key={sessionId} sessionId={sessionId} podeTestar={salvo !== null && !ocupado} />
                            <Card>
                                <CardHeader>
                                    <CardTitle>Versões publicadas</CardTitle>
                                    <CardDescription>{publicadoVersao ? `No ar agora: versão ${publicadoVersao}.` : "Nada publicado ainda: esta sessão usa o agente padrão."}</CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-2">
                                    {versoes.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma versão publicada.</p>}
                                    {versoes.map((v) => (
                                        <div key={v.versao} className="flex items-center justify-between gap-2 rounded-lg border p-2 text-sm">
                                            <span>Versão {v.versao} <span className="text-muted-foreground">({new Date(v.criadoEm).toLocaleString("pt-BR")})</span>{v.versao === publicadoVersao && " (no ar)"}</span>
                                            <Button size="sm" variant="outline" disabled={ocupado || v.versao === publicadoVersao} onClick={() => setConfirmar({ tipo: "versao", versao: v.versao })}>Voltar para esta</Button>
                                        </div>
                                    ))}
                                </CardContent>
                            </Card>
                        </aside>
                    </div>
                )}

                <AlertDialog open={confirmar !== null} onOpenChange={(o) => { if (!o) { setConfirmar(null); setModelo(""); } }}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>{confirmar?.tipo === "versao" ? `Voltar para a versão ${confirmar.versao}?` : "Substituir o rascunho?"}</AlertDialogTitle>
                            <AlertDialogDescription>
                                {confirmar?.tipo === "versao"
                                    ? "O rascunho será trocado por essa versão e ela volta a ficar no ar agora. O que você editou e não publicou será perdido."
                                    : `O modelo "${confirmar ? NOMES_MODELO[confirmar.chave] : ""}" vai substituir tudo o que está na tela. Nada é salvo nem publicado até você clicar nos botões.`}
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={aplicarConfirmacao}>Confirmar</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
        </SessionGuard>
    );
}
