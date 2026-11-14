import { createServer, Server as HttpServer } from "http";
import { AddressInfo } from "net";
import { Server } from "socket.io";
import { io as connect, Socket as Client } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { allowedOrigins, originAllowed, setupSocket, SocketDeps } from "./socket";

// Cookie "token=u1"/"token=u2" identifica o usuário; cada um é dono de uma sessão.
const dono: Record<string, string> = { "sessao-1": "u1", "sessao-2": "u2" };
const apagados = new Set<string>();
const revogados = new Set<string>(); // "userId|sessionId"
let agora = 1_000_000;

const deps: SocketDeps = {
    now: () => agora,
    identify: async (h) => {
        const c = String(h.cookie ?? "");
        if (c === "token=u1") return { userId: "u1" };
        if (c === "token=u2") return { userId: "u2" };
        if (c === "token=vencido") return { userId: "u1", exp: agora / 1000 - 10 };
        if (c === "token=curto") return { userId: "u1", exp: agora / 1000 + 30 };
        return null;
    },
    loadRole: async (id) => (apagados.has(id) ? null : "OWNER"),
    canAccess: async (u, _r, s) => dono[s] === u && !revogados.has(`${u}|${s}`),
};

let http: HttpServer, io: Server, ctl: ReturnType<typeof setupSocket>, port: number;
const clients: Client[] = [];

const cliente = (cookie?: string, origin?: string) => {
    const c = connect(`http://localhost:${port}`, {
        path: "/api/socket/io", transports: ["websocket"], reconnection: false,
        extraHeaders: { ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}) },
    });
    clients.push(c);
    return c;
};
const conectou = (c: Client) => new Promise<string>((res) => { c.on("connect", () => res("ok")); c.on("connect_error", (e) => res(e.message)); });
const pausa = (ms = 80) => new Promise((r) => setTimeout(r, ms));

beforeEach(async () => {
    apagados.clear(); revogados.clear(); agora = 1_000_000;
    http = createServer();
    io = new Server(http, {
        path: "/api/socket/io",
        allowRequest: (req, cb) => cb(null, originAllowed(req.headers.origin, req.headers.host, ["https://crm.exemplo.com"])),
    });
    ctl = setupSocket(io, deps);
    await new Promise<void>((r) => http.listen(0, r));
    port = (http.address() as AddressInfo).port;
});
afterEach(async () => {
    clients.splice(0).forEach((c) => c.close());
    ctl.stop();
    await io.close();
});

describe("handshake", () => {
    it("recusa conexão sem credencial", async () => {
        expect(await conectou(cliente())).toBe("unauthorized");
    });
    it("recusa cookie inválido e token vencido", async () => {
        expect(await conectou(cliente("token=lixo"))).toBe("unauthorized");
        expect(await conectou(cliente("token=vencido"))).toBe("unauthorized");
    });
    it("recusa usuário que não existe mais", async () => {
        apagados.add("u1");
        expect(await conectou(cliente("token=u1"))).toBe("unauthorized");
    });
    it("aceita sessão válida", async () => {
        expect(await conectou(cliente("token=u1"))).toBe("ok");
    });
});

describe("CORS / origem", () => {
    it("recusa origem não permitida, mesmo com cookie válido", async () => {
        expect(await conectou(cliente("token=u1", "https://evil.example"))).not.toBe("ok");
    });
    it("aceita a origem do app", async () => {
        expect(await conectou(cliente("token=u1", "https://crm.exemplo.com"))).toBe("ok");
    });
    it("originAllowed: sem lista só o mesmo host; com lista só a lista", () => {
        expect(originAllowed(undefined, "x", [])).toBe(true);
        expect(originAllowed("https://crm.exemplo.com", "crm.exemplo.com", [])).toBe(true);
        expect(originAllowed("https://evil.example", "crm.exemplo.com", [])).toBe(false);
        expect(originAllowed("https://evil.example", "crm.exemplo.com", ["https://crm.exemplo.com"])).toBe(false);
        expect(originAllowed("https://crm.exemplo.com", "interno:3030", ["https://crm.exemplo.com"])).toBe(true);
        expect(originAllowed("null", "x", [])).toBe(false);
    });
    it("allowedOrigins deriva de BASE_URL, NEXTAUTH_URL e lista opcional", () => {
        expect(allowedOrigins({ BASE_URL: "https://a.com/", NEXTAUTH_URL: "https://b.com", SOCKET_ALLOWED_ORIGINS: "https://c.com, lixo" } as never).sort())
            .toEqual(["https://a.com", "https://b.com", "https://c.com"]);
        expect(allowedOrigins({} as never)).toEqual([]);
    });
});

describe("salas", () => {
    it("isola dois usuários: cada um só entra na própria sessão e só recebe os próprios eventos", async () => {
        const a = cliente("token=u1"), b = cliente("token=u2");
        await Promise.all([conectou(a), conectou(b)]);
        const recebidoA: string[] = [], recebidoB: string[] = [];
        a.on("connection.update", (d) => recebidoA.push(d.qr));
        b.on("connection.update", (d) => recebidoB.push(d.qr));
        a.emit("join-session", "sessao-1"); a.emit("join-session", "sessao-2"); // a tenta entrar na do outro
        b.emit("join-session", "sessao-2"); b.emit("join-session", "sessao-1");
        await pausa();
        io.to("sessao-1").emit("connection.update", { qr: "QR-1" });
        io.to("sessao-2").emit("connection.update", { qr: "QR-2" });
        await pausa();
        expect(recebidoA).toEqual(["QR-1"]);
        expect(recebidoB).toEqual(["QR-2"]);
    });
    it("join-user-room ignora o id enviado e usa o do usuário autenticado", async () => {
        const a = cliente("token=u1"), b = cliente("token=u2");
        await Promise.all([conectou(a), conectou(b)]);
        const got: string[] = [];
        a.on("notification:new", (d) => got.push("A" + d.n));
        b.on("notification:new", (d) => got.push("B" + d.n));
        a.emit("join-user-room", "u2"); b.emit("join-user-room", "u2");
        await pausa();
        io.to("user:u2").emit("notification:new", { n: "x" });
        await pausa();
        expect(got).toEqual(["Bx"]);
    });
    it("sessionId chamado 'user:<id>' não dá acesso à sala de notificações de outro", async () => {
        dono["user:u2"] = "u1";
        const a = cliente("token=u1");
        await conectou(a);
        const got: unknown[] = [];
        a.on("notification:new", (d) => got.push(d));
        a.emit("join-session", "user:u2");
        await pausa();
        io.to("user:u2").emit("notification:new", { n: 1 });
        await pausa();
        delete dono["user:u2"];
        expect(got).toEqual([]);
    });
});

describe("revogação", () => {
    it("perdeu acesso à sessão: sai da sala na próxima revalidação", async () => {
        const a = cliente("token=u1");
        await conectou(a);
        const got: string[] = [];
        a.on("connection.update", (d) => got.push(d.qr));
        a.emit("join-session", "sessao-1");
        await pausa();
        io.to("sessao-1").emit("connection.update", { qr: "antes" });
        await pausa();
        revogados.add("u1|sessao-1");
        await ctl.revalidate();
        io.to("sessao-1").emit("connection.update", { qr: "depois" });
        await pausa();
        expect(got).toEqual(["antes"]);
    });
    it("usuário apagado é desconectado", async () => {
        const a = cliente("token=u1");
        await conectou(a);
        apagados.add("u1");
        const caiu = new Promise((r) => a.on("disconnect", r));
        await ctl.revalidate();
        await caiu;
        expect(a.connected).toBe(false);
    });
    it("token que vence com o socket aberto é desconectado", async () => {
        const a = cliente("token=curto");
        await conectou(a);
        agora += 60_000;
        const caiu = new Promise((r) => a.on("disconnect", r));
        await ctl.revalidate();
        await caiu;
        expect(a.connected).toBe(false);
    });
    it("join-session é rechecado no banco: acesso revogado antes do join é negado", async () => {
        const a = cliente("token=u1");
        await conectou(a);
        revogados.add("u1|sessao-1");
        const got: string[] = [];
        a.on("connection.update", (d) => got.push(d.qr));
        a.emit("join-session", "sessao-1");
        await pausa();
        io.to("sessao-1").emit("connection.update", { qr: "x" });
        await pausa();
        expect(got).toEqual([]);
    });
});
