import { Server, Socket } from "socket.io";
import { logger } from "../lib/logger";

/**
 * Autenticação e autorização do Socket.IO.
 * - Handshake: lê o cookie de sessão do Auth.js (o cliente é mesma origem, o cookie vai junto). Sem sessão válida, recusa.
 * - join-session: só entra na sala se o usuário (papel lido do banco) puder acessar a sessão (`canAccessSession`).
 * - join-user-room: ignora o argumento do cliente e entra só na sala do próprio usuário.
 * - Revogação: a cada REVALIDATE_MS o servidor confere token vencido, usuário apagado e acesso a cada sala de sessão;
 *   perdeu acesso, sai da sala (ou desconecta, se o token/usuário não vale mais). Pior caso de atraso: REVALIDATE_MS.
 */

export const REVALIDATE_MS = 60_000;
/** Teto de salas de sessão por socket e intervalo mínimo entre dois join-session do mesmo socket. */
export const MAX_SALAS = 20;
export const JOIN_MIN_MS = 150;

export type SocketIdentity = { userId: string; exp?: number };

export interface SocketDeps {
    /** Decodifica o cookie de sessão do handshake; null se ausente ou inválido. */
    identify: (headers: Record<string, string | string[] | undefined>) => Promise<SocketIdentity | null>;
    /** Papel atual do usuário no banco; null se o usuário não existe mais. */
    loadRole: (userId: string) => Promise<string | null>;
    canAccess: (userId: string, role: string, sessionId: string) => Promise<boolean>;
    now?: () => number;
}

type Data = { userId?: string; exp?: number; sessions?: Set<string>; ultimoJoin?: number };
const dados = (s: Socket) => s.data as Data;

export async function defaultDeps(): Promise<SocketDeps> {
    const { getToken } = await import("next-auth/jwt");
    const { prisma } = await import("../lib/prisma");
    const { canAccessSession } = await import("../lib/api-auth");
    return {
        identify: async (headers) => {
            const secret = process.env.AUTH_SECRET;
            if (!secret) return null;
            const cookie = String(headers.cookie ?? "");
            // O Auth.js usa prefixo __Secure- quando o site é HTTPS; o nome do cookie também é o "salt" do JWT.
            for (const secure of [true, false]) {
                const salt = `${secure ? "__Secure-" : ""}authjs.session-token`;
                if (!cookie.includes(salt)) continue;
                try {
                    const token = await getToken({ req: { headers: { cookie } } as never, secret, secureCookie: secure, salt });
                    if (token?.id) return { userId: String(token.id), exp: typeof token.exp === "number" ? token.exp : undefined };
                } catch {
                    /* cookie inválido: tenta o próximo */
                }
            }
            return null;
        },
        loadRole: async (id) => (await prisma.user.findUnique({ where: { id }, select: { role: true } }))?.role ?? null,
        canAccess: canAccessSession,
    };
}

/** Origens permitidas: BASE_URL, NEXTAUTH_URL e a lista opcional SOCKET_ALLOWED_ORIGINS (separada por vírgula). */
export function allowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
    const out = new Set<string>();
    for (const v of [env.BASE_URL, env.NEXTAUTH_URL, ...(env.SOCKET_ALLOWED_ORIGINS ?? "").split(",")]) {
        const t = v?.trim();
        if (!t) continue;
        try { out.add(new URL(t).origin); } catch { /* ignora valor inválido */ }
    }
    return [...out];
}

/** Sem Origin (cliente não-navegador) passa e continua exigindo cookie; com Origin precisa estar na lista ou ser o próprio host. */
export function originAllowed(origin: string | undefined, host: string | undefined, allowed: string[]): boolean {
    if (!origin) return true;
    if (allowed.includes(origin)) return true;
    if (allowed.length) return false;
    try { return !!host && new URL(origin).host === host; } catch { return false; }
}

export function setupSocket(io: Server, deps?: SocketDeps) {
    const ready = deps ? Promise.resolve(deps) : defaultDeps();
    const now = deps?.now ?? Date.now;

    io.use(async (socket, next) => {
        try {
            const d = await ready;
            const who = await d.identify(socket.handshake.headers);
            if (!who) return next(new Error("unauthorized"));
            if (who.exp && who.exp * 1000 <= now()) return next(new Error("unauthorized"));
            if (!(await d.loadRole(who.userId))) return next(new Error("unauthorized"));
            Object.assign(dados(socket), { userId: who.userId, exp: who.exp, sessions: new Set<string>() });
            next();
        } catch (err) {
            logger.error("Socket", "Handshake error:", err);
            next(new Error("unauthorized"));
        }
    });

    io.on("connection", (socket) => {
        logger.info("Socket", "Client connected:", socket.id);
        const data = dados(socket);

        socket.on("disconnect", () => logger.info("Socket", "Client disconnected:", socket.id));

        socket.on("join-session", async (sessionId: unknown) => {
            // "user:" é o prefixo das salas de usuário: um sessionId escolhido pelo cliente não pode colidir com elas.
            if (typeof sessionId !== "string" || !sessionId || sessionId.length > 200 || sessionId.startsWith("user:") || !data.userId) return;
            const t = Date.now();
            if (data.ultimoJoin && t - data.ultimoJoin < JOIN_MIN_MS) { socket.emit("join-session:erro", { sessionId, motivo: "muitas-requisicoes" }); return; }
            data.ultimoJoin = t;
            if (!data.sessions?.has(sessionId) && (data.sessions?.size ?? 0) >= MAX_SALAS) { socket.emit("join-session:erro", { sessionId, motivo: "limite-de-salas" }); return; }
            try {
                const d = await ready;
                const role = await d.loadRole(data.userId);
                if (!role || !(await d.canAccess(data.userId, role, sessionId))) {
                    logger.warn("Socket", `join-session negado: ${socket.id}`);
                    return;
                }
                data.sessions?.add(sessionId);
                await socket.join(sessionId);
            } catch (err) {
                logger.error("Socket", "join-session error:", err);
            }
        });

        // O argumento do cliente é ignorado de propósito: a sala é sempre a do usuário autenticado.
        socket.on("join-user-room", () => {
            if (data.userId) void socket.join(`user:${data.userId}`);
        });
    });

    // Trava de reentrância: se a rodada anterior (banco lento) não terminou, pula esta em vez de empilhar.
    let rodando = false;
    const rodar = async () => {
        if (rodando) return;
        rodando = true;
        try { await revalidate(io, ready, now); } catch (err) { logger.error("Socket", "revalidate error:", err); } finally { rodando = false; }
    };
    const timer = setInterval(() => void rodar(), REVALIDATE_MS);
    timer.unref?.();
    return { stop: () => clearInterval(timer), revalidate: () => revalidate(io, ready, now), rodar };
}

/** Confere token vencido, usuário apagado e acesso a cada sala de sessão de cada socket conectado. */
export async function revalidate(io: Server, ready: Promise<SocketDeps>, now: () => number) {
    const d = await ready;
    const papeis = new Map<string, Promise<string | null>>(); // um loadRole por usuário na rodada
    const papel = (id: string) => { if (!papeis.has(id)) papeis.set(id, d.loadRole(id)); return papeis.get(id)!; };
    for (const socket of io.sockets.sockets.values()) {
        const data = dados(socket);
        try {
            if (!data.userId || (data.exp && data.exp * 1000 <= now())) { socket.disconnect(true); continue; }
            const role = await papel(data.userId);
            if (!role) { socket.disconnect(true); continue; }
            for (const room of [...(data.sessions ?? [])]) {
                if (!(await d.canAccess(data.userId, role, room))) {
                    await socket.leave(room);
                    data.sessions?.delete(room);
                }
            }
        } catch (err) {
            logger.error("Socket", "revalidate error:", err);
        }
    }
}
