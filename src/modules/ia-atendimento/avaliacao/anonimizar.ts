/**
 * Anonimização de conversas para treinar a atendente de vendas fora do sistema.
 * Melhor esforço, determinístico: o João deve passar o olho no arquivo antes de compartilhar.
 * Nunca roda no navegador do cliente: só na rota de exportação (SUPERADMIN).
 */

/** Números públicos do Saiaê que podem aparecer (suporte e número oficial de vendas). */
const NUMEROS_PUBLICOS = new Set(["61982694384", "5561982694384", "61999531848", "5561999531848"]);

const soDigitos = (s: string) => s.replace(/\D/g, "");

/** Sequência que parece telefone/CPF/CNPJ: 8+ dígitos, com separadores comuns. */
const RE_NUMERO = /(?:\+?\(?\d[\d\s().\-/]{6,}\d)/g;
const RE_EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const RE_URL = /\b(?:https?:\/\/|www\.)\S+/gi;
/** "meu nome é Ana", "sou a Maria", "me chamo João Silva", "aqui é o Carlos": troca o nome. */
const RE_NOME = /\b(meu nome (?:é|e)|me chamo|aqui (?:é|e) (?:o|a)|sou (?:o|a)|chamo-me)\s+([A-ZÀ-Ý][\p{L}'-]+(?:\s+[A-ZÀ-Ý][\p{L}'-]+){0,2})/gu;

export function anonimizarTexto(texto: string): string {
    let t = texto;
    t = t.replace(RE_EMAIL, "[EMAIL]");
    // links: o do Saiaê fica, os demais saem
    t = t.replace(RE_URL, (u) => (/saiae\.com\.br/i.test(u) ? u : "[LINK]"));
    t = t.replace(RE_NUMERO, (m) => {
        const d = soDigitos(m);
        if (d.length < 8) return m;
        return NUMEROS_PUBLICOS.has(d) ? m : "[NÚMERO]";
    });
    t = t.replace(RE_NOME, (_m, pre: string) => `${pre} [NOME]`);
    return t;
}

export interface MensagemExport {
    direcao: string;
    texto: string;
    criadoEm: Date;
}

/** Uma conversa em texto corrido: sem telefone, sem nome do perfil, só "Cliente" e "Atendente". */
export function formatarConversa(numero: number, mensagens: MensagemExport[]): string {
    const linhas = mensagens.map((m) => {
        const quem = m.direcao === "in" ? "Cliente" : "Atendente";
        const quando = m.criadoEm.toISOString().slice(0, 16).replace("T", " ");
        return `[${quando}] ${quem}: ${anonimizarTexto(m.texto).replace(/\n+/g, " ⏎ ")}`;
    });
    return `=== Conversa ${numero} (${mensagens.length} mensagens) ===\n${linhas.join("\n")}\n`;
}
