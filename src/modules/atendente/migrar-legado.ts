import type { ConfigAgente } from "@/modules/agente-salao/agente";
import { MODELOS } from "./modelos-prontos";
import { CONTROLE, LIMITE_BASE_TOTAL, TreinoSchema, type Treino } from "./treino";

/**
 * Migração assistida: gera o Treino da atendente neutra a partir da configuração do agente do salão (AgenteConfig).
 * Parte do modelo "salão" e troca só o que a sessão já tem. Expediente, pausa e etiquetas continuam em AgenteConfig.
 * Nunca lança por tamanho ou formato: apara/limita e devolve avisos para o dono conferir antes de publicar.
 */

const FRASE = 2000;
const HORAS_MAX = 720;
const CONTROLE_G = new RegExp(CONTROLE.source, "g");
const HTTPS = /^https:\/\/\S+$/i;

const linkValido = (s: string) => {
    if (!HTTPS.test(s) || s.length > FRASE) return false;
    try {
        const u = new URL(s);
        return u.protocol === "https:" && !u.username && !u.password && u.hostname.includes(".") && !u.hostname.startsWith(".") && !u.hostname.endsWith(".");
    } catch {
        return false;
    }
};

export function treinoAPartirDoLegadoComAvisos(cfg: ConfigAgente): { treino: Treino; avisos: string[] } {
    const avisos: string[] = [];
    const limpo = (s: string, onde: string) => {
        const r = s.replace(CONTROLE_G, "");
        if (r !== s) avisos.push(`${onde}: caracteres de controle removidos.`);
        return r.replace(/\r\n?/g, "\n").trim();
    };
    const modelo = MODELOS.salao;

    const nome = limpo(cfg.nome, "nome").slice(0, 200) || modelo.identidade.nome;
    let negocio = limpo(cfg.nomeNegocio ?? "", "nome do negócio").slice(0, 200);
    if (!negocio) {
        negocio = "nosso salão";
        avisos.push('O nome do negócio está vazio na configuração: usei "nosso salão". Edite na identidade.');
    }

    // Promoções entram inteiras; o conhecimento perde o que passar do teto da base.
    const promocoes = limpo(cfg.promocoes ?? "", "promoções");
    let conhecimento = limpo(cfg.conhecimento, "conhecimento");
    const espaco = Math.max(0, LIMITE_BASE_TOTAL - promocoes.length);
    if (conhecimento.length > espaco) {
        conhecimento = conhecimento.slice(0, espaco).trim();
        avisos.push(`O conhecimento passava do limite da base (${LIMITE_BASE_TOTAL} caracteres somados às promoções) e foi cortado no fim.`);
    }
    const atualizadoEm = modelo.base[0].atualizadoEm;
    const base: Treino["base"] = [{ titulo: "Conhecimento do salão", texto: conhecimento, atualizadoEm }];
    if (promocoes) base.push({ titulo: "Promoções vigentes", texto: promocoes, atualizadoEm });

    const link = cfg.linkAgendamento?.trim() ?? "";
    if (link && !linkValido(link)) avisos.push("O link de agendamento não é um endereço https válido: o desfecho ficou como passar para uma pessoa.");
    const desfecho: Treino["roteiro"]["desfecho"] = link && linkValido(link) ? { tipo: "link", link } : { tipo: "pessoa" };

    let intervaloHoras = Math.round(cfg.followUpHoras);
    if (!(intervaloHoras >= 1 && intervaloHoras <= HORAS_MAX)) {
        intervaloHoras = Math.min(HORAS_MAX, Math.max(1, Number.isFinite(intervaloHoras) ? intervaloHoras : 24));
        avisos.push(`followUpHoras (${cfg.followUpHoras}) fora de 1 a ${HORAS_MAX}: ajustado para ${intervaloHoras}.`);
    }
    let textos = modelo.followUp.textos;
    const fu = limpo(cfg.followUpTexto ?? "", "texto do follow-up");
    if (fu) {
        if (fu.length > FRASE) avisos.push(`O texto do follow-up passava de ${FRASE} caracteres e foi cortado.`);
        textos = [fu.slice(0, FRASE).trim()];
    }

    const treino: Treino = {
        ...structuredClone(modelo),
        identidade: { ...modelo.identidade, nome, negocio },
        base,
        roteiro: { ...structuredClone(modelo.roteiro), desfecho },
        // O agente legado manda UMA mensagem de follow-up.
        followUp: { maxMensagens: 1, intervaloHoras, textos: [...textos] },
    };
    const r = TreinoSchema.safeParse(treino);
    if (!r.success) throw new Error(`Treino migrado inválido: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    return { treino: r.data, avisos };
}

export const treinoAPartirDoLegado = (cfg: ConfigAgente): Treino => treinoAPartirDoLegadoComAvisos(cfg).treino;

// ---------------------------------------------------------------- apoio do script (lógica pura, testada aqui)

export type Argumentos = { sessao: string; aplicar: boolean; confirmoAmbiente: boolean } | { erro: string };

export function lerArgumentos(argv: string[]): Argumentos {
    let sessao = "";
    let aplicar = false;
    let confirmoAmbiente = false;
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--sessao") {
            const v = argv[++i];
            if (!v || v.startsWith("--")) return { erro: "Informe o id da sessão depois de --sessao." };
            sessao = v;
        } else if (a === "--aplicar") aplicar = true;
        else if (a === "--confirmo-ambiente") confirmoAmbiente = true;
        else return { erro: `Argumento desconhecido: ${a}` };
    }
    if (!sessao) return { erro: "Informe --sessao <baileysSessionId>." };
    if (aplicar && !confirmoAmbiente) return { erro: "--aplicar exige também --confirmo-ambiente (confira o banco de destino antes)." };
    return { sessao, aplicar, confirmoAmbiente };
}

/** Só host:porta do banco, para conferência; nunca usuário, senha ou nome do banco. */
export function hostDoBanco(url: string | undefined): string {
    if (!url) return "(DATABASE_URL ausente)";
    try {
        return new URL(url).host || "(host não identificado)";
    } catch {
        return "(DATABASE_URL ilegível)";
    }
}

export function resumirTreino(t: Treino, avisos: string[]): string {
    const tam = t.base.reduce((s, b) => s + b.texto.length, 0);
    const d = t.roteiro.desfecho;
    const linhas = [
        `identidade: ${t.identidade.nome} / ${t.identidade.negocio}`,
        `base: ${t.base.length} item(ns), ${tam} caracteres (${t.base.map((b) => `${b.titulo}=${b.texto.length}`).join(", ")})`,
        `roteiro: ${t.roteiro.etapas.length} etapa(s); desfecho: ${d.tipo === "link" ? `link ${d.link}` : "pessoa"}`,
        `gatilhos: ${t.gatilhos.length}; objeções: ${t.objecoes.length}; exemplos: ${t.exemplos.length}`,
        `follow-up: ${t.followUp.maxMensagens} mensagem(ns) a cada ${t.followUp.intervaloHoras}h, ${t.followUp.textos.length} texto(s)`,
        ...avisos.map((a) => `AVISO: ${a}`),
    ];
    return linhas.join("\n");
}
