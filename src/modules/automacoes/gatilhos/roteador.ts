import { isOptOutText } from "@/lib/optout";
import { dmDentroDaJanela, respostaPrivadaDentroDaJanela, JANELA_DM_MS, JANELA_RESPOSTA_PRIVADA_MS } from "./canal";
import { GATILHOS, gatilhoHabilitado, type AmbienteGatilhos, type Canal, type TipoGatilho } from "./catalogo";
import type { EventoComentario, EventoDm, EventoSocial } from "./eventos";
import type { Valor } from "../tipos";

/**
 * Roteia eventos sociais (já verificados por HMAC na rota) para fluxos. Regras:
 * - flag desligada, permissão ausente ou sem provedor de envio: nada dispara (`gatilho_desabilitado`);
 * - deduplicação por id de evento (o mesmo evento reentregue não dispara de novo);
 * - isolamento: o evento de uma conta só olha fluxos do(s) dono(s) DESSA conta;
 * - opt-out ("SAIR"/"PARAR") e opt-out gravado bloqueiam; janela de DM (24 h) e de resposta privada (7 dias, uma vez por comentário).
 */

export interface GatilhoDoFluxo { tipo: TipoGatilho; canal: Canal; accountId: string; palavras?: string[]; postId?: string }
export interface FluxoComGatilho { flowId: string; trigger: GatilhoDoFluxo }
export interface ContaSocial { accountId: string; userId: string }

export interface DepsRoteador {
    ambiente: AmbienteGatilhos;
    agoraMs(): number;
    contasPorExterno(canal: Canal, externalId: string): Promise<ContaSocial[]>;
    fluxosDaConta(userId: string, accountId: string): Promise<FluxoComGatilho[]>;
    /** Atômico: true só na primeira vez que a chave é vista. */
    reservar(chave: string): Promise<boolean>;
    optedOut(accountId: string, remetenteId: string): Promise<boolean>;
    registrarOptOut(accountId: string, remetenteId: string): Promise<void>;
    iniciar(i: { userId: string; flowId: string; contactKey: string; dedupeKey: string; variaveis: Record<string, Valor> }): Promise<{ ok: boolean; motivo?: string }>;
}

export type Desfecho =
    | { resultado: "iniciado"; flowId: string; userId: string }
    | { resultado: "ignorado"; motivo: "conta_desconhecida" | "evento_duplicado" | "optout" | "optout_registrado" | "fora_da_janela" | "sem_fluxo_correspondente" | "resposta_privada_ja_usada" | "gatilho_desabilitado" }
    | { resultado: "falhou"; flowId: string; motivo: string };

const normalizar = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const palavraPresente = (texto: string, palavra: string) => {
    const p = normalizar(palavra).trim();
    return p !== "" && new RegExp(`(^|[^\\p{L}\\p{N}])${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "u").test(normalizar(texto));
};

const idGatilho = (canal: Canal, tipo: TipoGatilho) => GATILHOS.find((g) => g.canal === canal && g.tipo === tipo)?.id ?? "";

function casa(t: GatilhoDoFluxo, ev: EventoSocial): boolean {
    if (t.canal !== ev.canal) return false;
    const palavras = (Array.isArray(t.palavras) ? t.palavras : []).filter((p): p is string => typeof p === "string" && p.trim() !== "");
    if (ev.tipo === "dm") {
        if (t.tipo === "dm_qualquer") return true;
        return t.tipo === "dm_palavra_chave" && palavras.some((p) => palavraPresente(ev.texto, p));
    }
    if (t.tipo !== "comentario_post") return false;
    if (t.postId && t.postId !== ev.postId) return false;
    return palavras.length === 0 || palavras.some((p) => palavraPresente(ev.texto, p));
}

function variaveis(ev: EventoSocial, t: GatilhoDoFluxo): Record<string, Valor> {
    const base: Record<string, Valor> = { canal: ev.canal, gatilho: t.tipo, conta_externa_id: ev.contaExternaId, texto_recebido: ev.texto.slice(0, 500), evento_id: ev.eventoId };
    if (ev.tipo === "dm") return { ...base, remetente_id: ev.remetenteId, janela_ate_ms: ev.emMs + JANELA_DM_MS };
    // contexto do comentário preservado para depois das esperas: o envio da resposta privada usa estes ids e confere a janela
    return { ...base, remetente_id: ev.autorId, autor_id: ev.autorId, comentario_id: ev.comentarioId, post_id: ev.postId, janela_ate_ms: ev.emMs + JANELA_RESPOSTA_PRIVADA_MS };
}

export async function processarEventoSocial(ev: EventoSocial, deps: DepsRoteador): Promise<Desfecho[]> {
    const tiposDoEvento: TipoGatilho[] = ev.tipo === "dm" ? ["dm_palavra_chave", "dm_qualquer"] : ["comentario_post"];
    // Se nenhum gatilho aplicável ao evento está habilitado, não toca em nada (nem dedupe, nem banco).
    if (!tiposDoEvento.some((t) => gatilhoHabilitado(idGatilho(ev.canal, t), deps.ambiente))) return [{ resultado: "ignorado", motivo: "gatilho_desabilitado" }];

    const contas = await deps.contasPorExterno(ev.canal, ev.contaExternaId);
    if (contas.length === 0) return [{ resultado: "ignorado", motivo: "conta_desconhecida" }];
    if (!(await deps.reservar(`evento:${ev.canal}:${ev.contaExternaId}:${ev.eventoId}`))) return [{ resultado: "ignorado", motivo: "evento_duplicado" }];

    const remetente = ev.tipo === "dm" ? (ev as EventoDm).remetenteId : (ev as EventoComentario).autorId;
    const agora = deps.agoraMs();
    const saida: Desfecho[] = [];
    for (const conta of contas) {
        if (ev.tipo === "dm" && isOptOutText(ev.texto)) { await deps.registrarOptOut(conta.accountId, remetente); saida.push({ resultado: "ignorado", motivo: "optout_registrado" }); continue; }
        if (await deps.optedOut(conta.accountId, remetente)) { saida.push({ resultado: "ignorado", motivo: "optout" }); continue; }
        const dentro = ev.tipo === "dm" ? dmDentroDaJanela(ev.emMs, agora) : respostaPrivadaDentroDaJanela(ev.emMs, agora);
        if (!dentro) { saida.push({ resultado: "ignorado", motivo: "fora_da_janela" }); continue; }

        // só fluxos do dono desta conta, e só gatilhos que apontam para esta conta
        const fluxos = (await deps.fluxosDaConta(conta.userId, conta.accountId)).filter((f) => {
            try { return f.trigger.accountId === conta.accountId && gatilhoHabilitado(idGatilho(f.trigger.canal, f.trigger.tipo), deps.ambiente) && casa(f.trigger, ev); } catch { return false; } // gatilho malformado de um fluxo não derruba os outros
        });
        if (fluxos.length === 0) { saida.push({ resultado: "ignorado", motivo: "sem_fluxo_correspondente" }); continue; }
        for (const f of fluxos) {
            // resposta privada: no máximo uma por comentário (por conta), mesmo que mais de um fluxo case
            if (ev.tipo === "comentario" && !(await deps.reservar(`resposta_privada:${conta.accountId}:${(ev as EventoComentario).comentarioId}`))) { saida.push({ resultado: "ignorado", motivo: "resposta_privada_ja_usada" }); break; }
            let r: { ok: boolean; motivo?: string };
            try { r = await deps.iniciar({ userId: conta.userId, flowId: f.flowId, contactKey: `${ev.canal}:${remetente}`, dedupeKey: ev.eventoId, variaveis: variaveis(ev, f.trigger) }); } catch { r = { ok: false, motivo: "erro" }; }
            saida.push(r.ok ? { resultado: "iniciado", flowId: f.flowId, userId: conta.userId } : { resultado: "falhou", flowId: f.flowId, motivo: r.motivo ?? "erro" });
            if (ev.tipo === "comentario") break;
        }
    }
    return saida;
}
