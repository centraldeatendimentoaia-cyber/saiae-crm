import { describe, expect, it } from "vitest";
import { devidoFollowUp, ehComandoDevolver, iaPausada, pessoaAssumiu, primeiroNome, salaoAberto, textoFollowUp, type ConversaEstado } from "./estado";

const cfg = { diasAbertos: "2,3,4,5,6", horaAbre: 9, horaFecha: 18, followUpHoras: 12 };
// 2026-10-13 é terça-feira. Brasília = UTC-3.
const terca10h = new Date("2026-10-13T13:00:00Z");
const terca17h59 = new Date("2026-10-13T20:59:00Z");
const terca18h = new Date("2026-10-13T21:00:00Z");
const segunda10h = new Date("2026-10-12T13:00:00Z");
const domingo10h = new Date("2026-10-11T13:00:00Z");
const sabado12h = new Date("2026-10-17T15:00:00Z");

describe("salaoAberto", () => {
    it("terça a sábado, das 9h às 18h (Brasília)", () => {
        expect(salaoAberto(cfg, terca10h)).toBe(true);
        expect(salaoAberto(cfg, sabado12h)).toBe(true);
        expect(salaoAberto(cfg, terca17h59)).toBe(true);
        expect(salaoAberto(cfg, terca18h)).toBe(false);
        expect(salaoAberto(cfg, new Date("2026-10-13T11:59:00Z"))).toBe(false); // 8h59
    });
    it("segunda e domingo fechado", () => {
        expect(salaoAberto(cfg, segunda10h)).toBe(false);
        expect(salaoAberto(cfg, domingo10h)).toBe(false);
    });
});

describe("iaPausada e #lavinia", () => {
    it("só fica calada enquanto a pausa não venceu", () => {
        const agora = terca10h;
        expect(iaPausada({ estado: "humano", pausadaAte: new Date(agora.getTime() + 1000) }, agora)).toBe(true);
        expect(iaPausada({ estado: "humano", pausadaAte: new Date(agora.getTime() - 1000) }, agora)).toBe(false);
        expect(iaPausada({ estado: "ia", pausadaAte: new Date(agora.getTime() + 1000) }, agora)).toBe(false);
        expect(iaPausada({ estado: "humano", pausadaAte: null }, agora)).toBe(false);
    });
    it("reconhece o comando da recepção", () => {
        for (const t of ["#lavinia", " #Lavínia ", "# lavinia", "#LAVINIA"]) expect(ehComandoDevolver(t), t).toBe(true);
        for (const t of ["lavinia", "#lavinia obrigada", "oi #lavinia", ""]) expect(ehComandoDevolver(t), t).toBe(false);
    });
});

describe("pessoaAssumiu", () => {
    const base = { fromMe: true, enviadaPeloCrm: false, criadaEm: new Date(terca10h.getTime() - 5000), agora: terca10h, tipoEvento: "notify" };
    it("mensagem do número que NÃO saiu do CRM, recente: uma pessoa assumiu", () => {
        expect(pessoaAssumiu(base)).toBe(true);
        expect(pessoaAssumiu({ ...base, tipoEvento: "append" })).toBe(true);
    });
    it("o que o CRM/IA enviou nunca conta", () => {
        expect(pessoaAssumiu({ ...base, enviadaPeloCrm: true })).toBe(false);
    });
    it("mensagem de cliente, histórico antigo ou outro tipo de evento não contam", () => {
        expect(pessoaAssumiu({ ...base, fromMe: false })).toBe(false);
        expect(pessoaAssumiu({ ...base, criadaEm: new Date(terca10h.getTime() - 10 * 60_000) })).toBe(false);
        expect(pessoaAssumiu({ ...base, tipoEvento: "history" })).toBe(false);
    });
});

describe("devidoFollowUp", () => {
    const hAntes = (h: number) => new Date(terca10h.getTime() - h * 3_600_000);
    const base = (): ConversaEstado => ({ estado: "ia", pausadaAte: null, ultimaInboundAt: hAntes(13), ultimaIaAt: hAntes(12.5), ultimaIaPerguntou: true, ultimaHumanoAt: null, followUpEm: null });
    it("12 h depois da última resposta da IA (que perguntou algo), no horário de atendimento", () => {
        expect(devidoFollowUp(base(), cfg, terca10h)).toBe(true);
    });
    it("antes das 12 h, ou tarde demais (mais de 36 h), não", () => {
        expect(devidoFollowUp({ ...base(), ultimaIaAt: hAntes(11) }, cfg, terca10h)).toBe(false);
        expect(devidoFollowUp({ ...base(), ultimaIaAt: hAntes(40), ultimaInboundAt: hAntes(41) }, cfg, terca10h)).toBe(false);
    });
    it("só uma vez, e só se a cliente não respondeu", () => {
        expect(devidoFollowUp({ ...base(), followUpEm: hAntes(1) }, cfg, terca10h)).toBe(false);
        expect(devidoFollowUp({ ...base(), ultimaInboundAt: hAntes(5) }, cfg, terca10h)).toBe(false);
    });
    it("se uma pessoa falou depois da IA, ou a IA está calada, não manda", () => {
        expect(devidoFollowUp({ ...base(), ultimaHumanoAt: hAntes(6) }, cfg, terca10h)).toBe(false);
        expect(devidoFollowUp({ ...base(), estado: "humano", pausadaAte: new Date(terca10h.getTime() + 3_600_000) }, cfg, terca10h)).toBe(false);
    });
    it("se a IA não perguntou nada (despedida), não manda", () => {
        expect(devidoFollowUp({ ...base(), ultimaIaPerguntou: false }, cfg, terca10h)).toBe(false);
    });
    it("fora do horário de atendimento fica para depois", () => {
        const noite = new Date("2026-10-14T02:00:00Z"); // terça 23h
        expect(devidoFollowUp({ ...base(), ultimaIaAt: new Date(noite.getTime() - 12.5 * 3_600_000), ultimaInboundAt: new Date(noite.getTime() - 13 * 3_600_000) }, cfg, noite)).toBe(false);
        expect(devidoFollowUp({ ...base(), ultimaIaAt: new Date(domingo10h.getTime() - 12.5 * 3_600_000), ultimaInboundAt: new Date(domingo10h.getTime() - 13 * 3_600_000) }, cfg, domingo10h)).toBe(false);
    });
});

describe("nomes e texto do lembrete", () => {
    it("primeiro nome só de perfis que parecem nome", () => {
        expect(primeiroNome("MARIA da Silva")).toBe("Maria");
        expect(primeiroNome("ana")).toBe("Ana");
        expect(primeiroNome("💅✨")).toBeNull();
        expect(primeiroNome("a")).toBeNull();
        expect(primeiroNome(null)).toBeNull();
    });
    it("lembrete configurado pelo dono: {nome} vira o primeiro nome e some sem nome", () => {
        const modelo = "Oi, {nome}! Passando pra ver se ficou alguma dúvida sobre o Sai aê.";
        expect(textoFollowUp("Ana", null, modelo)).toBe("Oi, Ana! Passando pra ver se ficou alguma dúvida sobre o Sai aê.");
        expect(textoFollowUp(null, null, modelo)).toBe("Oi! Passando pra ver se ficou alguma dúvida sobre o Sai aê.");
        expect(textoFollowUp("Ana", null, "   ")).toContain("recepção ver um horário"); // vazio = padrão do salão
    });
    it("lembrete leve, com ou sem nome e serviço", () => {
        expect(textoFollowUp("Ana", "banho de gel")).toBe("Oi, Ana! Passando pra ver se você conseguiu decidir sobre banho de gel. Se quiser, eu passo pra recepção ver um horário pra você 💛");
        expect(textoFollowUp(null, null)).toBe("Oi! Passando pra ver se você conseguiu decidir. Se quiser, eu passo pra recepção ver um horário pra você 💛");
    });
});

describe("pessoaAssumiu: saudação automática", () => {
    const agora = new Date("2026-11-03T13:00:00Z");
    const base = { fromMe: true, enviadaPeloCrm: false, agora, tipoEvento: "notify" };
    it("fromMe até 10 s depois da cliente escrever é automática e não pausa a IA", () => {
        const inbound = new Date(agora.getTime() - 5_000);
        expect(pessoaAssumiu({ ...base, criadaEm: agora, ultimaInboundAt: inbound })).toBe(false);
    });
    it("fromMe bem depois da cliente escrever, ou sem registro dela, é uma pessoa", () => {
        expect(pessoaAssumiu({ ...base, criadaEm: agora, ultimaInboundAt: new Date(agora.getTime() - 60_000) })).toBe(true);
        expect(pessoaAssumiu({ ...base, criadaEm: agora, ultimaInboundAt: null })).toBe(true);
    });
});
