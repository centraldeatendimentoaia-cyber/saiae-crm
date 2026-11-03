import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/modules/whatsapp/manager", () => ({ waManager: { getInstance: vi.fn() } }));

import type { WAMessage } from "@whiskeysockets/baileys";
import { lerConteudo, montarAvisoRecepcao, veioDeAnuncioMeta } from "./agente";
import { _zerarEnviados, foiEnviadaPeloCrm, marcarEnviadaPeloCrm } from "./enviados";

const msg = (message: unknown): WAMessage => ({ key: { remoteJid: "5561999990001@s.whatsapp.net", id: "X1" }, message }) as unknown as WAMessage;

describe("lerConteudo", () => {
    it("texto simples, texto estendido e legenda de imagem contam como texto", () => {
        expect(lerConteudo(msg({ conversation: "oi" }))).toMatchObject({ texto: "oi", audio: false, naoTexto: false, ignorar: false });
        expect(lerConteudo(msg({ extendedTextMessage: { text: "quanto é?" } })).texto).toBe("quanto é?");
        expect(lerConteudo(msg({ imageMessage: { caption: "quero assim" } })).texto).toBe("quero assim");
    });
    it("áudio e mídia sem legenda são marcados, sem texto", () => {
        expect(lerConteudo(msg({ audioMessage: {} }))).toMatchObject({ audio: true, texto: "" });
        expect(lerConteudo(msg({ imageMessage: {} }))).toMatchObject({ naoTexto: true, audio: false });
        expect(lerConteudo(msg({ stickerMessage: {} }))).toMatchObject({ naoTexto: true });
    });
    it("reação, protocolo e edição são ignorados", () => {
        expect(lerConteudo(msg({ reactionMessage: { text: "💛" } })).ignorar).toBe(true);
        expect(lerConteudo(msg({ protocolMessage: { type: 0 } })).ignorar).toBe(true);
        expect(lerConteudo(msg(undefined)).ignorar).toBe(true);
    });
});

describe("anúncio do Meta", () => {
    it("reconhece mensagem vinda de anúncio de clique para o WhatsApp", () => {
        expect(veioDeAnuncioMeta(msg({ extendedTextMessage: { text: "oi", contextInfo: { externalAdReply: { title: "Promo" } } } }))).toBe(true);
        expect(veioDeAnuncioMeta(msg({ conversation: "oi" }))).toBe(false);
    });
});

describe("aviso à recepção", () => {
    it("usa o formato combinado, sem inventar o que não sabe", () => {
        const t = montarAvisoRecepcao({ motivo: "agendamento", nome: "Ana", servico: "banho de gel", diaHorario: "sexta à tarde", resumo: "quer banho de gel", telefone: "5561999531848", nomePerfil: "Ana P." });
        expect(t).toBe(["Cliente aguardando resposta - bot", "Nome: Ana", "Telefone: +55 61 99953-1848", "Motivo: agendamento", "Serviço: banho de gel", "Dia/horário desejado: sexta à tarde", "Resumo: quer banho de gel"].join("\n"));
    });
    it("sem número (contato oculto) e sem dados: mostra traços e o nome do perfil", () => {
        const t = montarAvisoRecepcao({ motivo: "audio", telefone: null, nomePerfil: "maria silva" });
        expect(t).toContain("Nome: Maria");
        expect(t).toContain("Telefone: número oculto");
        expect(t).toContain("Motivo: áudio");
        expect(t).toContain("Serviço: -");
    });
});

describe("registro de IDs enviados pelo CRM", () => {
    it("lembra o ID por um tempo e esquece depois", () => {
        _zerarEnviados();
        const t0 = 1_000_000;
        marcarEnviadaPeloCrm("ABC", t0);
        expect(foiEnviadaPeloCrm("ABC", t0 + 1000)).toBe(true);
        expect(foiEnviadaPeloCrm("ABC", t0 + 11 * 60_000)).toBe(false);
        expect(foiEnviadaPeloCrm("OUTRO", t0)).toBe(false);
        expect(foiEnviadaPeloCrm(undefined)).toBe(false);
    });
});

describe("lerConteudo: respostas de botão e lista", () => {
    it("usa o texto escolhido pela cliente", () => {
        expect(lerConteudo(msg({ buttonsResponseMessage: { selectedDisplayText: "Quero agendar" } })).texto).toBe("Quero agendar");
        expect(lerConteudo(msg({ templateButtonReplyMessage: { selectedDisplayText: "Ver preços" } })).texto).toBe("Ver preços");
        expect(lerConteudo(msg({ listResponseMessage: { title: "Unhas" } }))).toMatchObject({ texto: "Unhas", naoTexto: false });
    });
});
