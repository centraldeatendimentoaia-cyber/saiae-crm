import type { Canal } from "./catalogo";

/** Eventos sociais normalizados a partir do webhook da Meta (Instagram/Messenger). Parser puro e tolerante a lixo. */

export interface EventoDm { tipo: "dm"; canal: Canal; eventoId: string; contaExternaId: string; remetenteId: string; texto: string; emMs: number }
export interface EventoComentario { tipo: "comentario"; canal: Canal; eventoId: string; contaExternaId: string; comentarioId: string; postId: string; autorId: string; texto: string; emMs: number }
export type EventoSocial = EventoDm | EventoComentario;

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const obj = (v: unknown): Record<string, unknown> | undefined => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
const num = (v: unknown, padrao: number) => (typeof v === "number" && Number.isFinite(v) ? v : padrao);

export function normalizarWebhookSocial(payload: unknown, agoraMs = Date.now()): EventoSocial[] {
    const p = obj(payload);
    const object = str(p?.object);
    const canal: Canal | null = object === "instagram" ? "instagram" : object === "page" ? "messenger" : null;
    if (!canal || !Array.isArray(p?.entry)) return [];
    const saida: EventoSocial[] = [];
    for (const entry of p.entry as unknown[]) {
        const e = obj(entry);
        const conta = str(e?.id);
        if (!e || !conta) continue;
        for (const m of Array.isArray(e.messaging) ? e.messaging : []) {
            const x = obj(m), msg = obj(x?.message);
            const mid = str(msg?.mid), remetente = str(obj(x?.sender)?.id);
            // eco da própria conta (is_echo) e mensagem sem texto não disparam nada
            if (!x || !msg || !mid || !remetente || msg.is_echo === true || remetente === conta) continue;
            const texto = str(msg.text);
            if (texto === undefined) continue;
            saida.push({ tipo: "dm", canal, eventoId: `dm:${mid}`, contaExternaId: conta, remetenteId: remetente, texto, emMs: num(x.timestamp, agoraMs) });
        }
        for (const c of Array.isArray(e.changes) ? e.changes : []) {
            const x = obj(c), v = obj(x?.value);
            const campo = str(x?.field);
            // Instagram: field "comments"; Página: field "feed" com item "comment" e verbo "add"
            const ehIg = canal === "instagram" && campo === "comments";
            const ehFb = canal === "messenger" && campo === "feed" && v?.item === "comment" && v?.verb === "add";
            if (!v || !(ehIg || ehFb)) continue;
            const comentarioId = str(v.id) ?? str(v.comment_id);
            const autorId = str(obj(v.from)?.id);
            const postId = str(obj(v.media)?.id) ?? str(v.post_id);
            if (!comentarioId || !autorId || !postId || autorId === conta) continue;
            saida.push({ tipo: "comentario", canal, eventoId: `comentario:${comentarioId}`, contaExternaId: conta, comentarioId, postId, autorId, texto: str(v.text) ?? str(v.message) ?? "", emMs: num(v.created_time, agoraMs) });
        }
    }
    return saida;
}
