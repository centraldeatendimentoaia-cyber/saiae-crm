"use client";

import type { Dispatch, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EmojiTextarea } from "@/components/emoji-textarea";
import { MediaUpload } from "@/components/media-upload";
import { RecipientPicker } from "@/components/recipient-picker";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { RefreshCw, Send, Calendar } from "lucide-react";
import type { useAiCopies } from "./use-ai-copies";

export function RecipientsCard({ sessionId, contacts, onContactsChange, loading, recipientCount, quota }: {
    sessionId: string | undefined;
    contacts: string;
    onContactsChange: (v: string) => void;
    loading: boolean;
    recipientCount: number;
    quota: { used: number; max: number | null } | null;
}) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Destinatários</CardTitle>
                <CardDescription>Escolha por contatos, etiquetas, grupos ou planilha, ou digite os números (separados por vírgula ou quebra de linha).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <RecipientPicker sessionId={sessionId} value={contacts} onChange={onContactsChange} disabled={loading} />
                <div className="space-y-2">
                    <Label>Lista de destino (ex.: 5511999999999) — você pode editar</Label>
                    <Textarea
                        placeholder={"5511999999999\n5511988888888"}
                        className="min-h-[140px] font-mono text-sm"
                        value={contacts}
                        onChange={e => onContactsChange(e.target.value)}
                        disabled={loading}
                    />
                    <p className="text-xs text-muted-foreground">
                        {recipientCount}  números identificados
                        {quota && quota.max !== null && (
                            <> · restam {Math.max(0, quota.max - quota.used).toLocaleString("pt-BR")} disparos neste mês</>
                        )}
                    </p>
                </div>
            </CardContent>
        </Card>
    );
}

export function MessageCard({
    message, setMessage, variants, setVariants, mediaUrl, setMediaUrl, optOutFooter, setOptOutFooter,
    delay, setDelay, loading, ai, canSend, sending, onSend, onSchedule,
}: {
    message: string;
    setMessage: Dispatch<SetStateAction<string>>;
    variants: string[];
    setVariants: Dispatch<SetStateAction<string[]>>;
    mediaUrl: string;
    setMediaUrl: (v: string) => void;
    optOutFooter: boolean;
    setOptOutFooter: (v: boolean) => void;
    delay: number[];
    setDelay: (v: number[]) => void;
    loading: boolean;
    ai: ReturnType<typeof useAiCopies>;
    canSend: boolean;
    sending: boolean;
    onSend: () => void;
    onSchedule: () => void;
}) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Conteúdo da mensagem</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-2">
                    <Label>Mensagem</Label>
                    <EmojiTextarea
                        placeholder="Digite sua mensagem aqui..."
                        className="min-h-[150px]"
                        value={message}
                        onValueChange={setMessage}
                        disabled={loading}
                        toolbar={
                            <>
                                <span className="ml-1 text-xs text-muted-foreground">Inserir:</span>
                                <Button type="button" size="sm" variant="outline" disabled={loading}
                                    onClick={() => setMessage(m => (m ? m + " " : "") + "{primeironome}")}>
                                    {"{primeironome}"}
                                </Button>
                                <Button type="button" size="sm" variant="outline" disabled={loading}
                                    onClick={() => setMessage(m => (m ? m + " " : "") + "{nome}")}>
                                    {"{nome}"}
                                </Button>
                            </>
                        }
                    />
                    <p className="text-xs text-muted-foreground">
                        Cada cliente recebe o próprio nome (ex.: "Oi, {"{primeironome}"}!" vira "Oi, Maria!"). Se o nome não for conhecido, a variável some sozinha. Para escolher um texto reserva, use {"{primeironome|cliente}"}.
                    </p>
                </div>

                <div className="space-y-3">
                    {variants.map((v, i) => (
                        <div key={i} className="space-y-2">
                            <div className="flex items-center justify-between">
                                <Label>Versão {i + 2} do texto</Label>
                                <Button type="button" size="sm" variant="ghost" disabled={loading}
                                    onClick={() => setVariants(vs => vs.filter((_, j) => j !== i))}>Remover</Button>
                            </div>
                            <EmojiTextarea
                                className="min-h-[110px]"
                                value={v}
                                onValueChange={t => setVariants(vs => vs.map((x, j) => (j === i ? t : x)))}
                                disabled={loading}
                            />
                        </div>
                    ))}
                    {variants.length < 4 && (
                        <Button type="button" size="sm" variant="outline" disabled={loading} onClick={() => setVariants(vs => [...vs, ""])}>
                            + Adicionar outra versão do texto
                        </Button>
                    )}
                    <p className="text-xs text-muted-foreground">
                        Com mais de uma versão, os destinatários recebem as versões em rodízio. Mensagens diferentes entre si ajudam a não parecer envio em massa.
                    </p>
                </div>

                <div className="space-y-2">
                    <Label>Imagem (opcional)</Label>
                    <MediaUpload value={mediaUrl} onChange={setMediaUrl} disabled={loading} />
                </div>

                <label className="flex items-start gap-2 text-sm">
                    <Checkbox checked={optOutFooter} onCheckedChange={c => setOptOutFooter(c === true)} disabled={loading} className="mt-0.5" />
                    <span>
                        Incluir no fim da mensagem: <em>"Para não receber mais mensagens, responda SAIR."</em>
                        <span className="block text-xs text-muted-foreground">Quem responder SAIR é removido automaticamente dos próximos disparos e agendamentos desse número. Reduz denúncias.</span>
                    </span>
                </label>

                <div className="space-y-3 border border-border p-4">
                    <p className="kicker">Gerar texto com IA</p>
                    <EmojiTextarea
                        className="min-h-[130px]"
                        placeholder={"Descreva o que você quer comunicar, com o máximo de detalhes.\nEx.: promoção de hidratação em outubro para clientes antigas, 20% de desconto até sexta, horário de atendimento até 19h."}
                        value={ai.objective}
                        onValueChange={ai.setObjective}
                        maxLength={1000}
                        disabled={ai.loading || loading}
                        onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") ai.generate(); }}
                        toolbar={
                            <Button type="button" size="sm" variant="secondary" onClick={ai.generate} disabled={ai.loading || loading} className="ml-auto">
                                {ai.loading ? "Gerando..." : "Gerar texto"}
                            </Button>
                        }
                    />
                    {ai.copies.map((c, i) => (
                        <div key={i}>
                        <button
                            type="button"
                            onClick={() => setMessage(c)}
                            className="block w-full border border-border p-3 text-left text-sm whitespace-pre-wrap hover:border-foreground transition-colors"
                        >
                            {c}
                            <span className="kicker mt-2 block">Clique para usar esta versão</span>
                        </button>
                        <Button type="button" size="sm" variant="ghost" disabled={loading || variants.length >= 4}
                            onClick={() => setVariants(vs => [...vs, c])}>Adicionar como outra versão (rodízio)</Button>
                        </div>
                    ))}
                </div>

                <div className="space-y-4 pt-4">
                    <div className="space-y-2">
                        <Label>Intervalo: {(delay[0] / 1000).toFixed(1)}s</Label>
                        <Slider
                            defaultValue={[2000]}
                            min={1000}
                            max={15000}
                            step={500}
                            value={delay}
                            onValueChange={setDelay}
                            disabled={loading}
                        />
                        <p className="text-xs text-muted-foreground">Intervalo entre mensagens (+ aleatório).</p>
                    </div>

                    <Button className="w-full" onClick={onSend} disabled={!canSend}>
                        {sending ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                        {sending ? "Disparando..." : "Iniciar disparo"}
                    </Button>

                    <Button variant="outline" className="w-full" onClick={onSchedule} disabled={!canSend}>
                        <Calendar className="mr-2 h-4 w-4" />
                        Agendar disparo
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
