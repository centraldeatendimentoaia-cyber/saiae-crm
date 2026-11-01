"use client";

import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Treino } from "@/modules/atendente/treino";
import { LIMITE_EXEMPLOS, LIMITE_GATILHOS, LIMITE_OBJECOES } from "@/modules/atendente/treino";
import {
    atualizarEm, novaBase, novaEtapa, novaObjecao, novoExemplo, novoGatilho, podeAdicionarExemplo, podeAdicionarGatilho, podeAdicionarObjecao,
    podeRemoverGatilho, removerEm, trocarDesfecho,
} from "@/modules/atendente/editor";

export interface SecaoProps {
    t: Treino;
    onChange: (t: Treino) => void;
    disabled?: boolean;
}

function Secao({ titulo, descricao, children }: { titulo: string; descricao?: string; children: ReactNode }) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>{titulo}</CardTitle>
                {descricao && <CardDescription>{descricao}</CardDescription>}
            </CardHeader>
            <CardContent className="space-y-4">{children}</CardContent>
        </Card>
    );
}

function Campo({ rotulo, children }: { rotulo: string; children: ReactNode }) {
    const id = useId();
    return (
        <div className="space-y-1.5">
            <Label htmlFor={id}>{rotulo}</Label>
            {isValidElement(children) ? cloneElement(children as ReactElement<{ id?: string }>, { id }) : children}
        </div>
    );
}

function Item({ onRemover, children, rotulo, disabled }: { onRemover?: () => void; children: ReactNode; rotulo: string; disabled?: boolean }) {
    return (
        <div className="space-y-3 rounded-lg border p-3">
            {children}
            {onRemover && (
                <Button type="button" variant="ghost" size="sm" onClick={onRemover} disabled={disabled} aria-label={`Remover ${rotulo}`}>
                    <Trash2 className="mr-1 h-4 w-4" />Remover
                </Button>
            )}
        </div>
    );
}

const Vazio = ({ children }: { children: ReactNode }) => <p className="text-sm text-muted-foreground">{children}</p>;

export function SecaoIdentidade({ t, onChange, disabled }: SecaoProps) {
    const set = (patch: Partial<Treino["identidade"]>) => onChange({ ...t, identidade: { ...t.identidade, ...patch } });
    return (
        <Secao titulo="Identidade" descricao="Quem é a atendente e como ela fala.">
            <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="Nome da atendente"><Input value={t.identidade.nome} onChange={(e) => set({ nome: e.target.value })} disabled={disabled} maxLength={200} /></Campo>
                <Campo rotulo="Nome do negócio"><Input value={t.identidade.negocio} onChange={(e) => set({ negocio: e.target.value })} disabled={disabled} maxLength={200} /></Campo>
            </div>
            <Campo rotulo="Tom de voz"><Textarea rows={3} value={t.identidade.tom} onChange={(e) => set({ tom: e.target.value })} disabled={disabled} maxLength={2000} placeholder="Ex.: simpática, direta, sem gírias." /></Campo>
        </Secao>
    );
}

export function SecaoBase({ t, onChange, disabled }: SecaoProps) {
    const total = t.base.reduce((s, b) => s + b.texto.length, 0);
    return (
        <Secao titulo="Base de conhecimento" descricao={`Tudo o que a atendente pode afirmar: serviços, preços, regras. Ela não inventa fora disto. Total: ${total.toLocaleString("pt-BR")} de 40.000 caracteres.`}>
            {t.base.length === 0 && <Vazio>Nenhum item ainda. Adicione serviços, preços e regras do negócio.</Vazio>}
            {t.base.map((b, i) => (
                <Item key={i} rotulo={`item ${i + 1} da base`} disabled={disabled} onRemover={() => onChange({ ...t, base: removerEm(t.base, i) })}>
                    <Campo rotulo="Título"><Input value={b.titulo} onChange={(e) => onChange({ ...t, base: atualizarEm(t.base, i, { titulo: e.target.value }) })} disabled={disabled} maxLength={200} /></Campo>
                    <Campo rotulo="Texto"><Textarea rows={5} value={b.texto} onChange={(e) => onChange({ ...t, base: atualizarEm(t.base, i, { texto: e.target.value }) })} disabled={disabled} /></Campo>
                </Item>
            ))}
            <Button type="button" variant="outline" disabled={disabled || t.base.length >= 200} onClick={() => onChange({ ...t, base: [...t.base, novaBase()] })}><Plus className="mr-1 h-4 w-4" />Adicionar item</Button>
        </Secao>
    );
}

export function SecaoRoteiro({ t, onChange, disabled }: SecaoProps) {
    const d = t.roteiro.desfecho;
    const setEtapas = (etapas: Treino["roteiro"]["etapas"]) => onChange({ ...t, roteiro: { ...t.roteiro, etapas } });
    return (
        <Secao titulo="Roteiro" descricao="As etapas da conversa, em ordem, e como ela termina.">
            {t.roteiro.etapas.length === 0 && <Vazio>Nenhuma etapa. Sem roteiro, a atendente conduz a conversa só pela base e pelo tom.</Vazio>}
            {t.roteiro.etapas.map((e, i) => (
                <Item key={i} rotulo={`etapa ${i + 1}`} disabled={disabled} onRemover={() => setEtapas(removerEm(t.roteiro.etapas, i))}>
                    <Campo rotulo={`Etapa ${i + 1}: nome`}><Input value={e.nome} onChange={(ev) => setEtapas(atualizarEm(t.roteiro.etapas, i, { nome: ev.target.value }))} disabled={disabled} maxLength={200} /></Campo>
                    <Campo rotulo="O que fazer"><Textarea rows={3} value={e.instrucao} onChange={(ev) => setEtapas(atualizarEm(t.roteiro.etapas, i, { instrucao: ev.target.value }))} disabled={disabled} /></Campo>
                </Item>
            ))}
            <Button type="button" variant="outline" disabled={disabled || t.roteiro.etapas.length >= 20} onClick={() => setEtapas([...t.roteiro.etapas, novaEtapa()])}><Plus className="mr-1 h-4 w-4" />Adicionar etapa</Button>
            <div className="space-y-2 rounded-lg border p-3">
                <Label>Desfecho</Label>
                <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant={d.tipo === "link" ? "default" : "outline"} disabled={disabled} onClick={() => onChange(trocarDesfecho(t, "link", d.tipo === "link" ? d.link : ""))}>Enviar um link</Button>
                    <Button type="button" size="sm" variant={d.tipo === "pessoa" ? "default" : "outline"} disabled={disabled} onClick={() => onChange(trocarDesfecho(t, "pessoa"))}>Passar para uma pessoa</Button>
                </div>
                {d.tipo === "link" ? (
                    <Campo rotulo="Link (https://)"><Input value={d.link ?? ""} onChange={(e) => onChange(trocarDesfecho(t, "link", e.target.value))} disabled={disabled} placeholder="https://..." inputMode="url" /></Campo>
                ) : (
                    <Vazio>No fim do roteiro a conversa passa para a equipe.</Vazio>
                )}
            </div>
        </Secao>
    );
}

export function SecaoGatilhos({ t, onChange, disabled }: SecaoProps) {
    const set = (gatilhos: Treino["gatilhos"]) => onChange({ ...t, gatilhos });
    return (
        <Secao titulo="Gatilhos" descricao={`Situações em que a atendente chama uma pessoa. Os padrão só podem ser desligados ou editados. Máximo de ${LIMITE_GATILHOS} no total.`}>
            {t.gatilhos.map((g, i) => (
                <Item key={g.id} rotulo={`gatilho ${g.id}`} disabled={disabled} onRemover={podeRemoverGatilho(g.id) ? () => set(removerEm(t.gatilhos, i)) : undefined}>
                    <label className="flex items-center justify-between gap-3">
                        <span className="text-sm font-medium">{g.id}{podeRemoverGatilho(g.id) ? "" : " (padrão)"}: {g.ativo ? "ativo" : "desligado"}</span>
                        <Switch checked={g.ativo} onCheckedChange={(v) => set(atualizarEm(t.gatilhos, i, { ativo: v }))} disabled={disabled} aria-label={`Ativar gatilho ${g.id}`} />
                    </label>
                    <Campo rotulo="Quando acontece"><Textarea rows={2} value={g.descricao} onChange={(e) => set(atualizarEm(t.gatilhos, i, { descricao: e.target.value }))} disabled={disabled} /></Campo>
                    <Campo rotulo="Frase enviada ao passar para uma pessoa"><Textarea rows={2} value={g.frase} onChange={(e) => set(atualizarEm(t.gatilhos, i, { frase: e.target.value }))} disabled={disabled} /></Campo>
                </Item>
            ))}
            <Button type="button" variant="outline" disabled={disabled || !podeAdicionarGatilho(t)} onClick={() => set([...t.gatilhos, novoGatilho(t.gatilhos)])}><Plus className="mr-1 h-4 w-4" />Adicionar gatilho</Button>
        </Secao>
    );
}

export function SecaoObjecoes({ t, onChange, disabled }: SecaoProps) {
    const set = (objecoes: Treino["objecoes"]) => onChange({ ...t, objecoes });
    return (
        <Secao titulo="Objeções" descricao={`Dúvidas e resistências comuns e como responder. Até ${LIMITE_OBJECOES}.`}>
            {t.objecoes.length === 0 && <Vazio>Nenhuma objeção cadastrada.</Vazio>}
            {t.objecoes.map((o, i) => (
                <Item key={i} rotulo={`objeção ${i + 1}`} disabled={disabled} onRemover={() => set(removerEm(t.objecoes, i))}>
                    <Campo rotulo="O cliente diz"><Input value={o.cliente} onChange={(e) => set(atualizarEm(t.objecoes, i, { cliente: e.target.value }))} disabled={disabled} /></Campo>
                    <Campo rotulo="Resposta"><Textarea rows={3} value={o.resposta} onChange={(e) => set(atualizarEm(t.objecoes, i, { resposta: e.target.value }))} disabled={disabled} /></Campo>
                    <Campo rotulo="Próximo passo"><Input value={o.proximoPasso} onChange={(e) => set(atualizarEm(t.objecoes, i, { proximoPasso: e.target.value }))} disabled={disabled} /></Campo>
                </Item>
            ))}
            <Button type="button" variant="outline" disabled={disabled || !podeAdicionarObjecao(t)} onClick={() => set([...t.objecoes, novaObjecao()])}><Plus className="mr-1 h-4 w-4" />Adicionar objeção</Button>
        </Secao>
    );
}

export function SecaoExemplos({ t, onChange, disabled }: SecaoProps) {
    const set = (exemplos: Treino["exemplos"]) => onChange({ ...t, exemplos });
    return (
        <Secao titulo="Exemplos" descricao={`Conversas modelo: o que o cliente diz e a resposta ideal. Até ${LIMITE_EXEMPLOS}.`}>
            {t.exemplos.length === 0 && <Vazio>Nenhum exemplo cadastrado.</Vazio>}
            {t.exemplos.map((x, i) => (
                <Item key={i} rotulo={`exemplo ${i + 1}`} disabled={disabled} onRemover={() => set(removerEm(t.exemplos, i))}>
                    <Campo rotulo="O cliente diz"><Input value={x.cliente} onChange={(e) => set(atualizarEm(t.exemplos, i, { cliente: e.target.value }))} disabled={disabled} /></Campo>
                    <Campo rotulo="Resposta ideal"><Textarea rows={3} value={x.ideal} onChange={(e) => set(atualizarEm(t.exemplos, i, { ideal: e.target.value }))} disabled={disabled} /></Campo>
                    <Campo rotulo="Evitar (opcional)"><Input value={x.evitar ?? ""} onChange={(e) => set(atualizarEm(t.exemplos, i, { evitar: e.target.value }))} disabled={disabled} /></Campo>
                </Item>
            ))}
            <Button type="button" variant="outline" disabled={disabled || !podeAdicionarExemplo(t)} onClick={() => set([...t.exemplos, novoExemplo()])}><Plus className="mr-1 h-4 w-4" />Adicionar exemplo</Button>
        </Secao>
    );
}

export function SecaoFollowUp({ t, onChange, disabled }: SecaoProps) {
    const f = t.followUp;
    const set = (patch: Partial<Treino["followUp"]>) => onChange({ ...t, followUp: { ...f, ...patch } });
    const num = (v: string, min: number, max: number) => Math.min(max, Math.max(min, Math.trunc(Number(v)) || min));
    return (
        <Secao titulo="Follow-up" descricao="Lembretes para quem parou de responder.">
            <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="Máximo de lembretes (0 a 5)"><Input type="number" min={0} max={5} value={f.maxMensagens} onChange={(e) => set({ maxMensagens: num(e.target.value, 0, 5) })} disabled={disabled} /></Campo>
                <Campo rotulo="Intervalo entre lembretes (horas)"><Input type="number" min={1} max={720} value={f.intervaloHoras} onChange={(e) => set({ intervaloHoras: num(e.target.value, 1, 720) })} disabled={disabled} /></Campo>
            </div>
            {f.textos.length === 0 && <Vazio>Nenhum texto de lembrete.</Vazio>}
            {f.textos.map((tx, i) => (
                <Item key={i} rotulo={`lembrete ${i + 1}`} disabled={disabled} onRemover={() => set({ textos: removerEm(f.textos, i) })}>
                    <Campo rotulo={`Lembrete ${i + 1}`}><Textarea rows={2} value={tx} onChange={(e) => set({ textos: f.textos.map((x, k) => (k === i ? e.target.value : x)) })} disabled={disabled} /></Campo>
                </Item>
            ))}
            <Button type="button" variant="outline" disabled={disabled || f.textos.length >= 10} onClick={() => set({ textos: [...f.textos, ""] })}><Plus className="mr-1 h-4 w-4" />Adicionar texto</Button>
        </Secao>
    );
}

export function SecaoVocabulario({ t, onChange, disabled }: SecaoProps) {
    const set = (patch: Partial<Treino["vocabulario"]>) => onChange({ ...t, vocabulario: { ...t.vocabulario, ...patch } });
    return (
        <Secao titulo="Vocabulário" descricao="Como o negócio chama quem compra (cliente, paciente, aluno...).">
            <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="No singular"><Input value={t.vocabulario.cliente} onChange={(e) => set({ cliente: e.target.value })} disabled={disabled} maxLength={100} /></Campo>
                <Campo rotulo="No plural"><Input value={t.vocabulario.clientes} onChange={(e) => set({ clientes: e.target.value })} disabled={disabled} maxLength={100} /></Campo>
            </div>
        </Secao>
    );
}
