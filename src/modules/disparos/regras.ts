import crypto from "crypto";
import { montarMensagem } from "@/modules/integracao/comanda/aviso-textos";

/** Constantes e regras puras das campanhas de disparo e da avaliação pós-entrega. */

export const MAX_DESTINATARIOS = 500;
export const MAX_TEXTO = 600;
export const RODAPE_SAIR = "Para não receber mais mensagens, responda SAIR.";
/** Tetos de campanha por número: "diaNovo" vale na primeira semana do vínculo. */
export const TETO_CAMPANHA = { minuto: 3, diaNovo: 20, diaNormal: 150 };
export const JITTER_CAMPANHA_MS = { min: 8_000, max: 25_000 };
export const VALIDADE_CAMPANHA_MS = 24 * 60 * 60 * 1000;
export const MAX_CAMPANHAS_DIA = 2;

const HORA_MS = 60 * 60 * 1000;
const DIA_MS = 24 * HORA_MS;
/** São Paulo é UTC-3 o ano todo (sem horário de verão desde 2019); não depende do fuso do servidor. */
const OFFSET_SP_MS = -3 * HORA_MS;
const ABRE = 9;
const FECHA = 20;

const horaEmSaoPaulo = (agora: number) => new Date(agora + OFFSET_SP_MS).getUTCHours();

/** 09:00 a 19:59 em America/Sao_Paulo. */
export function dentroDaJanela(agora: number): boolean {
    const h = horaEmSaoPaulo(agora);
    return h >= ABRE && h < FECHA;
}

/** Timestamp da próxima 09:00 de São Paulo (hoje, se ainda não chegou; senão amanhã). */
export function proximaJanela(agora: number): number {
    const local = agora + OFFSET_SP_MS;
    const inicioDoDia = Math.floor(local / DIA_MS) * DIA_MS;
    const alvoLocal = inicioDoDia + ABRE * HORA_MS + (horaEmSaoPaulo(agora) >= ABRE ? DIA_MS : 0);
    return alvoLocal - OFFSET_SP_MS;
}

/** Texto final da campanha: variáveis preenchidas e rodapé de descadastro, sem duplicá-lo. */
export function montarTextoCampanha(modelo: string, v: { nome: string | null; barraca: string }): string {
    const corpo = montarMensagem(modelo, { nome: v.nome, barraca: v.barraca });
    if (corpo.endsWith(RODAPE_SAIR)) return corpo;
    return `${corpo}\n\n${RODAPE_SAIR}`;
}

/** Identifica o cliente numa loja sem guardar o telefone: serve ao teto de 1 mensagem por cliente por 24 h. */
export function chaveDoCliente(barracaId: string, telefone: string): string {
    return crypto.createHash("sha256").update(`${barracaId}:${telefone}`).digest("hex");
}
