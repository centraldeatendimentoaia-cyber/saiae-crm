import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---- banco em memória (só o que o agente usa)
const mailer = vi.hoisted(() => ({ sendMail: vi.fn(async (_m: { to: string; subject: string; text: string }) => true) }));
vi.mock("@/lib/mailer", () => ({ sendMail: mailer.sendMail }));

const db = vi.hoisted(() => {
    const convs = new Map<string, Record<string, any>>();
    const key = (w: any) => `${w.sessionId_jid.sessionId}|${w.sessionId_jid.jid}`;
    const estado = { config: null as Record<string, any> | null, historico: [] as { fromMe: boolean; content: string }[], convs };
    const prisma = {
        agenteConfig: { findUnique: vi.fn(async () => estado.config) },
        session: { findUnique: vi.fn(async () => ({ id: "db-1" })) },
        message: { findMany: vi.fn(async () => [...estado.historico].reverse()) },
        label: { findFirst: vi.fn(async () => null) },
        chatLabel: { upsert: vi.fn(async () => ({})) },
        agenteConversa: {
            findUnique: vi.fn(async ({ where }: any) => convs.get(where.sessionId_jid ? key(where) : [...convs.keys()].find((k) => convs.get(k)!.id === where.id) ?? "") ?? null),
            upsert: vi.fn(async ({ where, create, update }: any) => {
                const k = key(where);
                const atual = convs.get(k);
                const novo = atual ? { ...atual, ...update } : { id: `c${convs.size + 1}`, estado: "ia", pausadaAte: null, ultimaInboundAt: null, ultimaIaAt: null, ultimaIaPerguntou: false, ultimaHumanoAt: null, followUpEm: null, ...create };
                convs.set(k, novo);
                return novo;
            }),
            update: vi.fn(async ({ where, data }: any) => {
                const k = where.sessionId_jid ? key(where) : [...convs.keys()].find((x) => convs.get(x)!.id === where.id)!;
                const novo = { ...convs.get(k)!, ...data };
                convs.set(k, novo);
                return novo;
            }),
        },
    };
    return { estado, prisma };
});
vi.mock("@/lib/prisma", () => ({ prisma: db.prisma }));
vi.mock("@/modules/whatsapp/manager", () => ({ waManager: { getInstance: vi.fn() } }));
vi.mock("@/lib/optout", async (orig) => ({ ...(await orig<typeof import("@/lib/optout")>()), isOptedOut: vi.fn(async () => false) }));

import type { WAMessage, WASocket } from "@whiskeysockets/baileys";
import type { Llm } from "@/modules/ia-atendimento/llm";
import { bindAgenteSalao, limparCacheConfigAgente } from "./agente";
import { _zerarEnviados, marcarEnviadaPeloCrm } from "./enviados";
import { MSG_AUDIO } from "./motor";

const SESSAO = "sessao-salao";
const GRUPO = "120363000000000000@g.us";
const CLIENTE = "5561999990001@s.whatsapp.net";
const T0 = new Date("2026-10-13T13:00:00Z"); // terça 10h em Brasília

function montar(llmTexto = "A escova custa R$ 50. Quer agendar?", extra: { transcrever?: (m: WAMessage) => Promise<string | null>; llm?: Llm } = {}) {
    const handlers: Record<string, (e: any) => Promise<void>> = {};
    const enviados: { jid: string; texto: string }[] = [];
    const sock = {
        ev: { on: (n: string, h: (e: any) => Promise<void>) => { handlers[n] = h; } },
        sendMessage: vi.fn(async (jid: string, c: { text: string }) => { enviados.push({ jid, texto: c.text }); return {}; }),
        sendPresenceUpdate: vi.fn(async () => undefined),
        addChatLabel: vi.fn(async () => undefined),
    } as unknown as WASocket;
    const llm: Llm = extra.llm ?? { responder: vi.fn(async () => ({ texto: llmTexto, chamadas: [] })) };
    bindAgenteSalao(sock, SESSAO, { llm, debounceMs: 7000, rapido: true, transcrever: extra.transcrever });
    const msg = (texto: string | null, over: { jid?: string; fromMe?: boolean; id?: string; audio?: boolean } = {}): WAMessage => ({
        key: { remoteJid: over.jid ?? CLIENTE, fromMe: over.fromMe ?? false, id: over.id ?? `M${Math.random()}` },
        messageTimestamp: Math.floor(Date.now() / 1000),
        pushName: "Ana",
        message: over.audio ? { audioMessage: {} } : { conversation: texto ?? "" },
    }) as unknown as WAMessage;
    const emitir = (m: WAMessage, type = "notify") => handlers["messages.upsert"]({ messages: [m], type });
    return { sock, llm, enviados, msg, emitir };
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    limparCacheConfigAgente();
    _zerarEnviados();
    db.estado.convs.clear();
    db.estado.historico = [];
    db.estado.config = { ativo: true, nome: "Lavínia", conhecimento: null, promocoes: null, linkAgendamento: "https://agendamento.avec.beauty/?slug=lavi-concept", grupoRecepcaoJid: GRUPO, numerosIgnorados: ["5561988887777"], followUpHoras: 12, pausaHoras: 12, diasAbertos: "2,3,4,5,6", horaAbre: 9, horaFecha: 18 };
    process.env.AGENTE_SALAO = "";
});
afterEach(() => vi.useRealTimers());

const esperar = (ms: number) => vi.advanceTimersByTimeAsync(ms);

describe("agente do salão (integração com socket falso)", () => {
    it("responde UMA vez a quem escreveu, depois de juntar as mensagens seguidas", async () => {
        const t = montar();
        await t.emitir(t.msg("oi"));
        await esperar(3000);
        await t.emitir(t.msg("quanto é a escova?"));
        await esperar(8000);
        expect(t.enviados).toEqual([{ jid: CLIENTE, texto: "A escova custa R$ 50. Quer agendar?" }]);
        expect(t.llm.responder).toHaveBeenCalledTimes(1);
        const conv = [...db.estado.convs.values()][0];
        expect(conv.ultimaIaPerguntou).toBe(true);
        expect(conv.ultimaIaAt).toBeInstanceOf(Date);
    });
    it("não responde com o agente desligado, a grupos, a números ignorados ou a mensagens antigas", async () => {
        const t = montar();
        db.estado.config!.ativo = false;
        await t.emitir(t.msg("oi"));
        db.estado.config!.ativo = true;
        limparCacheConfigAgente();
        await t.emitir(t.msg("oi", { jid: GRUPO }));
        await t.emitir(t.msg("oi", { jid: "5561988887777@s.whatsapp.net" }));
        const antiga = t.msg("oi");
        (antiga as any).messageTimestamp = Math.floor(Date.now() / 1000) - 3600;
        await t.emitir(antiga);
        await t.emitir(t.msg("oi"), "append");
        await esperar(10000);
        expect(t.enviados).toEqual([]);
    });
    it("uma pessoa escreve pelo celular: a IA se cala; mensagem do CRM não conta; depois da pausa volta", async () => {
        const t = montar();
        await t.emitir(t.msg("quanto é o corte?"));
        await esperar(8000);
        expect(t.enviados).toHaveLength(1);

        marcarEnviadaPeloCrm("DO-CRM");
        await t.emitir(t.msg("mensagem do disparo", { fromMe: true, id: "DO-CRM" }));
        await t.emitir(t.msg("Oi Ana, aqui é a recepção!", { fromMe: true, id: "DO-CELULAR" })); // pessoa
        const conv = [...db.estado.convs.values()][0];
        expect(conv.estado).toBe("humano");
        expect(conv.motivoPausa).toBe("pessoa_assumiu");

        await t.emitir(t.msg("e a escova?"));
        await esperar(8000);
        expect(t.enviados).toHaveLength(1); // calada

        await esperar(13 * 3_600_000); // passa a pausa
        await t.emitir(t.msg("alguém aí?"));
        await esperar(8000);
        expect(t.enviados).toHaveLength(2);
    });
    it("#lavinia digitado na conversa devolve a IA na hora", async () => {
        const t = montar();
        await t.emitir(t.msg("Oi, é a recepção", { fromMe: true, id: "H1" }));
        expect([...db.estado.convs.values()][0].estado).toBe("humano");
        await t.emitir(t.msg("#lavinia", { fromMe: true, id: "H2" }));
        expect([...db.estado.convs.values()][0].estado).toBe("ia");
        await t.emitir(t.msg("quanto é?"));
        await esperar(8000);
        expect(t.enviados).toHaveLength(1);
    });
    it("áudio: avisa a cliente, chama a recepção no grupo e se cala", async () => {
        const t = montar();
        await t.emitir(t.msg(null, { audio: true }));
        await esperar(8000);
        expect(t.llm.responder).not.toHaveBeenCalled();
        const paraCliente = t.enviados.filter((e) => e.jid === CLIENTE);
        const paraGrupo = t.enviados.filter((e) => e.jid === GRUPO);
        expect(paraCliente.map((e) => e.texto)).toEqual([MSG_AUDIO]);
        expect(paraGrupo).toHaveLength(1);
        expect(paraGrupo[0].texto).toContain("Cliente aguardando resposta - bot");
        expect(paraGrupo[0].texto).toContain("Motivo: áudio");
        expect([...db.estado.convs.values()][0].estado).toBe("humano");
    });
    it("áudio transcrito: a IA responde ao que foi dito, sem chamar a recepção", async () => {
        const t = montar("O corte feminino custa R$ 50. Quer agendar?", { transcrever: async () => "quanto custa o corte" });
        await t.emitir(t.msg(null, { audio: true }));
        await esperar(8000);
        expect(t.llm.responder).toHaveBeenCalledTimes(1);
        const entrada = (t.llm.responder as ReturnType<typeof vi.fn>).mock.calls[0][0] as { mensagens: { texto?: string }[]; sistema: string };
        expect(JSON.stringify(entrada.mensagens)).toContain("[áudio transcrito] quanto custa o corte");
        expect(t.enviados.map((e) => e.texto)).toEqual(["O corte feminino custa R$ 50. Quer agendar?"]);
        expect([...db.estado.convs.values()][0].estado).toBe("ia");
    });
    it("áudio que não deu para transcrever: volta ao aviso e chama a recepção", async () => {
        const t = montar("x", { transcrever: async () => null });
        await t.emitir(t.msg(null, { audio: true }));
        await esperar(8000);
        expect(t.llm.responder).not.toHaveBeenCalled();
        expect(t.enviados.some((e) => e.texto === MSG_AUDIO)).toBe(true);
    });
    it("áudio seguido de texto vira uma única conversa", async () => {
        const t = montar("ok?", { transcrever: async () => "quero fazer unha" });
        await t.emitir(t.msg(null, { audio: true }));
        await esperar(2000);
        await t.emitir(t.msg("sexta de tarde"));
        await esperar(8000);
        expect(t.llm.responder).toHaveBeenCalledTimes(1);
        expect(JSON.stringify((t.llm.responder as ReturnType<typeof vi.fn>).mock.calls[0][0].mensagens)).toContain("sexta de tarde");
    });
    it("aviso à equipe só por e-mail (sem grupo): chama, pausa a IA e manda o e-mail", async () => {
        mailer.sendMail.mockClear();
        db.estado.config!.grupoRecepcaoJid = null;
        db.estado.config!.emailAviso = "equipe@saiae.com.br";
        const respostas = [
            { chamadas: [{ id: "1", nome: "chamar_recepcao", argumentos: { motivo: "desconto", resumo: "pediu desconto no Pro" } }] },
            { texto: "Vou chamar a equipe pra te ajudar 💛", chamadas: [] },
        ];
        let i = 0;
        const t = montar("", { llm: { responder: vi.fn(async () => respostas[Math.min(i++, 1)]) } });
        await t.emitir(t.msg("faz 30% de desconto?"));
        await esperar(8000);
        expect(mailer.sendMail).toHaveBeenCalledTimes(1);
        const mail = mailer.sendMail.mock.calls[0][0];
        expect(mail.to).toBe("equipe@saiae.com.br");
        expect(mail.text).toContain("Motivo: desconto/condição especial");
        expect(t.enviados.map((e) => e.texto)).toEqual(["Vou chamar a equipe pra te ajudar 💛"]);
        expect([...db.estado.convs.values()][0].estado).toBe("humano");
    });
    it("sem nenhum canal de aviso (nem grupo nem e-mail): não diz que chamou", async () => {
        db.estado.config!.grupoRecepcaoJid = null;
        db.estado.config!.emailAviso = null;
        const respostas = [
            { chamadas: [{ id: "1", nome: "chamar_recepcao", argumentos: { motivo: "duvida" } }] },
            { texto: "A equipe responde assim que possível.", chamadas: [] },
        ];
        let i = 0;
        const t = montar("", { llm: { responder: vi.fn(async () => respostas[Math.min(i++, 1)]) } });
        await t.emitir(t.msg("tem estacionamento?"));
        await esperar(8000);
        expect([...db.estado.convs.values()][0].estado).toBe("ia"); // não pausou: ninguém foi avisado
    });
    it("conversa já aberta e IA calada: mensagens novas só atualizam a data, sem resposta", async () => {
        const t = montar();
        await t.emitir(t.msg("Oi, é a recepção", { fromMe: true, id: "H1" }));
        await t.emitir(t.msg("tá bom"));
        await esperar(8000);
        expect(t.llm.responder).not.toHaveBeenCalled();
        expect([...db.estado.convs.values()][0].ultimaInboundAt).toBeInstanceOf(Date);
    });
});
