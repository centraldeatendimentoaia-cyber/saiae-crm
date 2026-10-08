import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { getInstance } = vi.hoisted(() => ({ getInstance: vi.fn() }));
vi.mock("@/modules/whatsapp/manager", () => ({ waManager: { getInstance } }));

import { getProvider, cloudSessionIds, BaileysProvider } from "./index";
import { CloudApiProvider } from "@/modules/whatsapp/cloud/provider";
import { WindowClosedError } from "@/modules/whatsapp/cloud/errors";
import { requireCapability } from "./require";

const baileysInstance = (id: string) => ({ sessionId: id, socket: { sendMessage: vi.fn(), onWhatsApp: vi.fn() } });

beforeEach(() => {
    getInstance.mockReset();
    vi.stubEnv("WHATSAPP_CLOUD_SESSION_ID", "");
    vi.stubEnv("META_WA_ACCESS_TOKEN", "");
    vi.stubEnv("META_WA_PHONE_NUMBER_ID", "");
    vi.stubEnv("WHATSAPP_GRAPH_API_VERSION", "");
});
afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

const configureCloud = (sessions = "pilot") => {
    vi.stubEnv("WHATSAPP_CLOUD_SESSION_ID", sessions);
    vi.stubEnv("META_WA_ACCESS_TOKEN", "tok-de-teste");
    vi.stubEnv("META_WA_PHONE_NUMBER_ID", "123456");
};

describe("cloudSessionIds", () => {
    it("vazio ou ausente: nenhuma sessão", () => {
        expect(cloudSessionIds({}).size).toBe(0);
        expect(cloudSessionIds({ WHATSAPP_CLOUD_SESSION_ID: "  " }).size).toBe(0);
    });
    it("lista com vírgulas e espaços", () => {
        expect([...cloudSessionIds({ WHATSAPP_CLOUD_SESSION_ID: " a , b,,c " })]).toEqual(["a", "b", "c"]);
    });
});

describe("getProvider: escolha por variável de ambiente (sem mudar o banco)", () => {
    it("padrão (variável ausente): tudo continua Baileys", () => {
        getInstance.mockReturnValue(baileysInstance("s1"));
        const p = getProvider("s1");
        expect(p).toBeInstanceOf(BaileysProvider);
    });
    it("sessão fora do ar sem variável: null, como antes", () => {
        getInstance.mockReturnValue(undefined);
        expect(getProvider("s1")).toBeNull();
    });
    it("sessão listada e credenciais presentes: Cloud API, mesmo sem instância Baileys", () => {
        configureCloud("pilot");
        getInstance.mockReturnValue(undefined);
        const p = getProvider("pilot");
        expect(p).toBeInstanceOf(CloudApiProvider);
        expect(p?.name).toBe("cloud-api");
        expect(p?.sessionId).toBe("pilot");
        expect(p?.isConnected()).toBe(true);
        expect(getInstance).not.toHaveBeenCalled();
    });
    it("a variável vence mesmo que exista instância Baileys na mesma sessão", () => {
        configureCloud("pilot");
        getInstance.mockReturnValue(baileysInstance("pilot"));
        expect(getProvider("pilot")?.name).toBe("cloud-api");
    });
    it("outra sessão continua no Baileys", () => {
        configureCloud("pilot");
        getInstance.mockReturnValue(baileysInstance("outra"));
        expect(getProvider("outra")?.name).toBe("baileys");
    });
    it("várias sessões na lista", () => {
        configureCloud("a, b");
        expect(getProvider("a")?.name).toBe("cloud-api");
        expect(getProvider("b")?.name).toBe("cloud-api");
    });
    it("sessão listada SEM credenciais: null, NUNCA cai para o Baileys em silêncio", () => {
        vi.stubEnv("WHATSAPP_CLOUD_SESSION_ID", "pilot");
        getInstance.mockReturnValue(baileysInstance("pilot")); // existe Baileys, mas não pode usar
        expect(getProvider("pilot")).toBeNull();
    });
    it("só o token sem o phone_number_id também é configuração incompleta", () => {
        vi.stubEnv("WHATSAPP_CLOUD_SESSION_ID", "pilot");
        vi.stubEnv("META_WA_ACCESS_TOKEN", "tok");
        expect(getProvider("pilot")).toBeNull();
    });
});

describe("piloto: texto livre bloqueado (falha fechada), só template", () => {
    it("texto livre numa sessão Cloud: WindowClosedError e nenhuma chamada de rede", async () => {
        configureCloud("pilot");
        const fetchSpy = vi.spyOn(globalThis, "fetch");
        const p = getProvider("pilot")!;
        await expect(p.sendText("5561999990001", "oi")).rejects.toBeInstanceOf(WindowClosedError);
        await expect(p.sendMedia("5561999990001", { kind: "image", data: { url: "https://x.test/a.jpg" } })).rejects.toBeInstanceOf(WindowClosedError);
        expect(fetchSpy).not.toHaveBeenCalled();
    });
    it("template sai sem depender da janela (chama a API com a versão e o número configurados)", async () => {
        configureCloud("pilot");
        vi.stubEnv("WHATSAPP_GRAPH_API_VERSION", "v26.0");
        const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response(JSON.stringify({ messages: [{ id: "wamid.T1" }] }), { status: 200, headers: { "content-type": "application/json" } })
        );
        const r = await getProvider("pilot")!.sendTemplate!("5561999990001", { name: "pedido_pronto", languageCode: "pt_BR", bodyParameters: ["42"] });
        expect(r.messageId).toBe("wamid.T1");
        const [url, init] = fetchSpy.mock.calls[0];
        expect(String(url)).toBe("https://graph.facebook.com/v26.0/123456/messages");
        expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer tok-de-teste" });
    });
});

describe("rotas só-Baileys numa sessão Cloud API", () => {
    it("requireCapability devolve 501 (integração com a escolha por variável)", async () => {
        configureCloud("pilot");
        const res = requireCapability("pilot", "polls")!;
        expect(res.status).toBe(501);
        expect(await res.json()).toMatchObject({ code: "CAPABILITY_NOT_SUPPORTED", provider: "cloud-api" });
    });
    it("e segue (null) numa sessão Baileys", () => {
        configureCloud("pilot");
        getInstance.mockReturnValue(baileysInstance("outra"));
        expect(requireCapability("outra", "polls")).toBeNull();
    });
});
