"use client";

import { errorMessage } from "@/lib/errors";
import { useCallback, useEffect, useState } from "react";
import { Bot, Save, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useSession } from "@/components/dashboard/session-provider";
import { SessionGuard } from "@/components/dashboard/session-guard";

interface Config {
    ativo: boolean;
    nome: string;
    nomeNegocio: string;
    emailAviso: string;
    followUpTexto: string;
    etiquetasInteresse: string[];
    etiquetaAguardando: string;
    etiquetaFollowUp: string;
    etiquetaAnuncio: string;
    conhecimento: string;
    promocoes: string;
    linkAgendamento: string;
    grupoRecepcaoJid: string;
    numerosIgnorados: string[];
    followUpHoras: number;
    pausaHoras: number;
    diasAbertos: string;
    horaAbre: number;
    horaFecha: number;
    conhecimentoPadrao: string;
}

interface Grupo { jid: string; subject: string | null }

export default function AgenteIaPage() {
    const { sessionId } = useSession();
    const [cfg, setCfg] = useState<Config | null>(null);
    const [grupos, setGrupos] = useState<Grupo[]>([]);
    const [ignorados, setIgnorados] = useState("");
    const [interesses, setInteresses] = useState("");
    const [salvando, setSalvando] = useState(false);

    const carregar = useCallback(async () => {
        if (!sessionId) return;
        const [c, g] = await Promise.all([fetch(`/api/agente/${sessionId}/config`).then((r) => r.json()), fetch(`/api/groups/${sessionId}`).then((r) => r.json()).catch(() => null)]);
        if (c?.status) {
            setCfg(c.data);
            setIgnorados((c.data.numerosIgnorados as string[]).join("\n"));
            setInteresses((c.data.etiquetasInteresse as string[]).join("\n"));
        }
        if (g?.status) setGrupos((g.data as Grupo[]).filter((x) => x.jid?.endsWith("@g.us")));
    }, [sessionId]);

    useEffect(() => { carregar(); }, [carregar]);

    const set = <K extends keyof Config>(k: K, v: Config[K]) => setCfg((c) => (c ? { ...c, [k]: v } : c));

    const salvar = async (extra: Partial<Config> = {}) => {
        if (!cfg) return;
        setSalvando(true);
        try {
            const corpo = {
                ativo: cfg.ativo,
                nome: cfg.nome,
                nomeNegocio: cfg.nomeNegocio || null,
                emailAviso: cfg.emailAviso || null,
                followUpTexto: cfg.followUpTexto || null,
                etiquetasInteresse: interesses.split("\n").map((e) => e.trim()).filter(Boolean),
                etiquetaAguardando: cfg.etiquetaAguardando || null,
                etiquetaFollowUp: cfg.etiquetaFollowUp || null,
                etiquetaAnuncio: cfg.etiquetaAnuncio || null,
                conhecimento: cfg.conhecimento,
                promocoes: cfg.promocoes,
                linkAgendamento: cfg.linkAgendamento || null,
                grupoRecepcaoJid: cfg.grupoRecepcaoJid || null,
                numerosIgnorados: ignorados.split(/[\n,;]+/).map((n) => n.replace(/\D/g, "")).filter(Boolean),
                followUpHoras: cfg.followUpHoras,
                pausaHoras: cfg.pausaHoras,
                horaAbre: cfg.horaAbre,
                horaFecha: cfg.horaFecha,
                diasAbertos: cfg.diasAbertos.replace(/,+/g, ",").replace(/^,|,$/g, "") || "2,3,4,5,6",
                ...extra,
            };
            const res = await fetch(`/api/agente/${sessionId}/config`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
            const j = await res.json();
            if (!res.ok || !j.status) throw new Error(j.message || "Falha ao salvar");
            toast.success("Salvo.");
            carregar();
        } catch (e) {
            toast.error(errorMessage(e, "Falha ao salvar"));
            carregar();
        } finally {
            setSalvando(false);
        }
    };

    return (
        <SessionGuard>
            <div className="space-y-4">
                <div>
                    <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-3xl"><Bot className="h-7 w-7" />Agente de atendimento</h2>
                    <p className="text-sm text-muted-foreground">
                        A atendente responde só quem escreve para este número, passa para a recepção quando precisa, se cala quando uma pessoa assume a conversa e manda um único lembrete se a cliente não responder.
                    </p>
                </div>

                {!cfg ? <p className="text-sm text-muted-foreground">Carregando...</p> : (
                    <>
                        <Card>
                            <CardHeader>
                                <CardTitle>Ligar o agente</CardTitle>
                                <CardDescription>Desligado por padrão. Para ligar é preciso um canal de aviso (grupo da recepção e/ou e-mail) e o link que a atendente envia (agendamento ou cadastro).</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <label className="flex items-center justify-between gap-3 rounded-lg border p-3">
                                    <span className="font-medium">Agente {cfg.ativo ? "ligado" : "desligado"} nesta sessão</span>
                                    <Switch checked={cfg.ativo} onCheckedChange={(v) => { set("ativo", v); salvar({ ativo: v }); }} disabled={salvando} />
                                </label>
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <div className="space-y-1">
                                        <Label>Grupo da recepção</Label>
                                        <select value={cfg.grupoRecepcaoJid} onChange={(e) => set("grupoRecepcaoJid", e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm">
                                            <option value="">Escolha o grupo</option>
                                            {grupos.map((g) => <option key={g.jid} value={g.jid}>{g.subject || "Grupo sem nome"}</option>)}
                                        </select>
                                        <p className="text-xs text-muted-foreground">O número do salão precisa estar nesse grupo. Os avisos "Cliente aguardando resposta - bot" vão para lá.</p>
                                    </div>
                                    <div className="space-y-1">
                                        <Label>E-mail para avisos (opcional)</Label>
                                        <Input value={cfg.emailAviso} onChange={(e) => set("emailAviso", e.target.value)} placeholder="equipe@suaempresa.com.br" />
                                        <p className="text-xs text-muted-foreground">Recebe o mesmo aviso do grupo. Use no lugar do grupo, ou junto.</p>
                                    </div>
                                    <div className="space-y-1">
                                        <Label>Link de agendamento ou de cadastro</Label>
                                        <Input value={cfg.linkAgendamento} onChange={(e) => set("linkAgendamento", e.target.value)} placeholder="https://agendamento.avec.beauty/?slug=..." />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>Identidade e etiquetas</CardTitle>
                                <CardDescription>Como a atendente se apresenta e quais etiquetas do WhatsApp ela usa. Os nomes das etiquetas precisam ser exatamente iguais aos do WhatsApp (sincronize em Etiquetas). Em branco = não etiqueta.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <div className="space-y-1"><Label>Nome da atendente</Label><Input value={cfg.nome} onChange={(e) => set("nome", e.target.value)} /></div>
                                    <div className="space-y-1"><Label>Nome do negócio</Label><Input value={cfg.nomeNegocio} onChange={(e) => set("nomeNegocio", e.target.value)} placeholder="Ex.: LAVI Concept" /></div>
                                </div>
                                <div className="space-y-1">
                                    <Label>Etiquetas de interesse (uma por linha)</Label>
                                    <Textarea value={interesses} onChange={(e) => setInteresses(e.target.value)} className="min-h-[90px]" placeholder={"Interesse: Unhas\nInteresse: Corte/Cor"} />
                                    <p className="text-xs text-muted-foreground">Explique no texto da atendente (abaixo) quando usar cada uma. Trocando de negócio, troque estas etiquetas e a seção de etiquetas do texto.</p>
                                </div>
                                <div className="grid gap-4 sm:grid-cols-3">
                                    <div className="space-y-1"><Label>Ao chamar a recepção</Label><Input value={cfg.etiquetaAguardando} onChange={(e) => set("etiquetaAguardando", e.target.value)} /></div>
                                    <div className="space-y-1"><Label>Ao mandar o lembrete</Label><Input value={cfg.etiquetaFollowUp} onChange={(e) => set("etiquetaFollowUp", e.target.value)} /></div>
                                    <div className="space-y-1"><Label>Conversa vinda de anúncio do Meta</Label><Input value={cfg.etiquetaAnuncio} onChange={(e) => set("etiquetaAnuncio", e.target.value)} /></div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>Regras de funcionamento</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-1">
                                    <Label>Dias de atendimento da equipe (0 = domingo ... 6 = sábado, separados por vírgula)</Label>
                                    <Input value={cfg.diasAbertos} onChange={(e) => set("diasAbertos", e.target.value.replace(/[^0-6,]/g, ""))} placeholder="2,3,4,5,6" />
                                    <p className="text-xs text-muted-foreground">Define quando o lembrete pode ser enviado e o que a IA diz sobre o atendimento humano. Terça a sábado = 2,3,4,5,6. Segunda a sexta = 1,2,3,4,5.</p>
                                </div>
                                <div className="grid gap-4 sm:grid-cols-4">
                                    <div className="space-y-1"><Label>Lembrete após (horas)</Label><Input type="number" min={1} max={30} value={cfg.followUpHoras} onChange={(e) => set("followUpHoras", Number(e.target.value) || 12)} /></div>
                                    <div className="space-y-1"><Label>IA calada após pessoa assumir (horas)</Label><Input type="number" min={1} max={72} value={cfg.pausaHoras} onChange={(e) => set("pausaHoras", Number(e.target.value) || 12)} /></div>
                                    <div className="space-y-1"><Label>Equipe atende a partir das</Label><Input type="number" min={0} max={23} value={cfg.horaAbre} onChange={(e) => set("horaAbre", Number(e.target.value))} /></div>
                                    <div className="space-y-1"><Label>Equipe atende até às</Label><Input type="number" min={1} max={24} value={cfg.horaFecha} onChange={(e) => set("horaFecha", Number(e.target.value))} /></div>
                                </div>
                                <div className="space-y-1">
                                    <Label>Números que a IA nunca atende (equipe, dono), um por linha</Label>
                                    <Textarea value={ignorados} onChange={(e) => setIgnorados(e.target.value)} className="min-h-[80px]" placeholder={"5561999990000"} />
                                </div>
                                <div className="space-y-1">
                                    <Label>Texto do lembrete (opcional)</Label>
                                    <Textarea value={cfg.followUpTexto} onChange={(e) => set("followUpTexto", e.target.value)} className="min-h-[70px]" placeholder={"Oi, {nome}! Passando pra ver se ficou alguma dúvida. Se quiser, é só me chamar 💛"} />
                                    <p className="text-xs text-muted-foreground">{"{nome}"} vira o primeiro nome da pessoa. Vazio = texto padrão do salão ("...eu passo pra recepção ver um horário").</p>
                                </div>
                                <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                                    <li>O lembrete é uma única mensagem, só para quem escreveu e não respondeu, e só no horário de atendimento (terça a sábado).</li>
                                    <li>Se alguém da equipe escrever na conversa pelo celular, a IA se cala pelo tempo acima. Para devolver antes, digite <strong>#lavinia</strong> na conversa.</li>
                                    <li>Se a recepção usa respostas automáticas deste CRM, desligue-as para este número, ou a cliente recebe duas respostas.</li>
                                </ul>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>Promoções vigentes</CardTitle>
                                <CardDescription>Só o que estiver aqui a atendente pode citar, com as condições e a validade. Vazio = "sem promoção no momento".</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <Textarea value={cfg.promocoes} onChange={(e) => set("promocoes", e.target.value)} className="min-h-[120px]"
                                    placeholder={"Nome da promoção\n- O que é:\n- Serviços incluídos:\n- Valor/desconto:\n- Validade: de DD/MM até DD/MM\n- Condições:"} />
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>O que a atendente sabe e como conversa</CardTitle>
                                <CardDescription>Serviços, preços, equipe, regras e tom. Mudou um preço? Edite aqui e salve. A atendente não afirma nada que não esteja neste texto.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-2">
                                <Textarea value={cfg.conhecimento} onChange={(e) => set("conhecimento", e.target.value)} className="min-h-[420px] font-mono text-xs" />
                                <Button type="button" variant="ghost" size="sm" onClick={() => { if (window.confirm("Voltar ao texto padrão da Lavínia? Suas edições neste campo serão perdidas.")) set("conhecimento", cfg.conhecimentoPadrao); }}>
                                    <RotateCcw className="h-4 w-4" /> Restaurar o texto padrão
                                </Button>
                            </CardContent>
                        </Card>

                        <div className="sticky bottom-2 flex justify-end">
                            <Button onClick={() => salvar()} disabled={salvando}><Save className="h-4 w-4" /> {salvando ? "Salvando..." : "Salvar alterações"}</Button>
                        </div>
                    </>
                )}
            </div>
        </SessionGuard>
    );
}
