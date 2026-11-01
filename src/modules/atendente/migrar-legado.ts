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
const LIMITE_PROMOCOES = LIMITE_BASE_TOTAL / 4;
const CONTROLE_G = new RegExp(CONTROLE.source, "g");
const HTTPS = /^https:\/\/\S+$/i;

const linkValido = (s: string) => {
    if (!HTTPS.test(s) || CONTROLE.test(s) || s.length > FRASE) return false;
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

    let nome = limpo(cfg.nome, "nome");
    if (!nome) {
        nome = modelo.identidade.nome;
        avisos.push(`O nome da atendente está vazio na configuração: usei "${nome}". Edite na identidade.`);
    } else if (nome.length > 200) {
        nome = nome.slice(0, 200).trim();
        avisos.push("O nome da atendente passava de 200 caracteres e foi cortado.");
    }
    let negocio = limpo(cfg.nomeNegocio ?? "", "nome do negócio");
    if (negocio.length > 200) {
        negocio = negocio.slice(0, 200).trim();
        avisos.push("O nome do negócio passava de 200 caracteres e foi cortado.");
    }
    if (!negocio) {
        negocio = "nosso salão";
        avisos.push('O nome do negócio está vazio na configuração: usei "nosso salão". Edite na identidade.');
    }

    // Orçamento da base: o conhecimento tem prioridade. As promoções valem até LIMITE_PROMOCOES (um quarto do teto) e o
    // conhecimento fica com o resto; quem passar do seu espaço é cortado no fim, com aviso. Nunca lança por tamanho.
    let promocoes = limpo(cfg.promocoes ?? "", "promoções");
    if (promocoes.length > LIMITE_PROMOCOES) {
        promocoes = promocoes.slice(0, LIMITE_PROMOCOES).trim();
        avisos.push(`As promoções passavam de ${LIMITE_PROMOCOES} caracteres e foram cortadas no fim.`);
    }
    let conhecimento = limpo(cfg.conhecimento, "conhecimento");
    if (!conhecimento) avisos.push("O conhecimento está vazio na configuração: a base ficou sem texto do negócio.");
    const espaco = LIMITE_BASE_TOTAL - promocoes.length;
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

export type Argumentos = { sessao: string; aplicar: boolean; confirmoAmbiente: boolean; sobrescrever: boolean } | { erro: string };

export function lerArgumentos(argv: string[]): Argumentos {
    let sessao = "";
    let aplicar = false;
    let confirmoAmbiente = false;
    let sobrescrever = false;
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--sessao") {
            const v = argv[++i];
            if (!v || v.startsWith("--")) return { erro: "Informe o id da sessão depois de --sessao." };
            sessao = v;
        } else if (a === "--aplicar") aplicar = true;
        else if (a === "--confirmo-ambiente") confirmoAmbiente = true;
        else if (a === "--sobrescrever") sobrescrever = true;
        else return { erro: `Argumento desconhecido: ${a}` };
    }
    if (!sessao) return { erro: "Informe --sessao <baileysSessionId>." };
    if (aplicar && !confirmoAmbiente) return { erro: "--aplicar exige também --confirmo-ambiente (confira o banco de destino antes)." };
    return { sessao, aplicar, confirmoAmbiente, sobrescrever };
}

/**
 * Só host:porta do banco, para conferência; nunca usuário, senha ou nome do banco. Não usa new URL: uma senha com "/", "?"
 * ou "#" sem codificar quebraria o parser e vazaria pedaços dela. Pega o que vem depois do ÚLTIMO "@" e corta em / ? #.
 */
export function hostDoBanco(url: string | undefined): string {
    if (!url) return "(DATABASE_URL ausente)";
    const m = /^[a-z][a-z0-9+.-]*:\/\/([\s\S]*)$/i.exec(url.trim());
    if (!m) return "host ilegível";
    const resto = m[1];
    const h = /^([A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(:\d{1,5})?(?:[/?#]|$)/.exec(resto.slice(resto.lastIndexOf("@") + 1));
    return h ? h[1] + (h[2] ?? "") : "host ilegível";
}

export type DecisaoGravacao = { ok: true } | { ok: false; erro: string };

/** Decide se pode gravar o rascunho: se já existe um, só com --sobrescrever. */
export function decidirGravacao(args: { rascunhoExiste: boolean; sobrescrever: boolean }): DecisaoGravacao {
    if (args.rascunhoExiste && !args.sobrescrever) {
        return { ok: false, erro: "Esta sessão já tem um rascunho da atendente. Nada foi gravado. Para substituí-lo, rode de novo com --sobrescrever." };
    }
    return { ok: true };
}

export const avisoRascunhoExistente = (existe: boolean) => (existe ? "ATENÇÃO: já existe um rascunho nesta sessão; --aplicar só o substitui com --sobrescrever." : "");

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
