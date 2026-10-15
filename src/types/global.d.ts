import type { Server } from "socket.io";

declare global {
    /** Servidor Socket.IO, publicado por src/server/index.ts para o restante do processo. */
    var io: Server | undefined;
}

export {};
