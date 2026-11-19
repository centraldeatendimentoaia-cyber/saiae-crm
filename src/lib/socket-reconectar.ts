import type { Socket } from "socket.io-client";

/**
 * O socket.io-client só reconecta sozinho quando a queda não foi decidida pelo servidor.
 * Aqui cobre "io server disconnect" (revalidação derrubou) e connect_error (handshake recusado),
 * com espera crescente (5 s até 60 s) e zerada ao conectar, para não martelar o servidor com sessão expirada.
 */
export function reconectarComEspera(socket: Socket, baseMs = 5_000, maxMs = 60_000) {
    let tentativas = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const agendar = () => {
        if (timer) return;
        const espera = Math.min(baseMs * 2 ** tentativas, maxMs);
        tentativas++;
        timer = setTimeout(() => { timer = undefined; if (!socket.active) socket.connect(); }, espera);
    };
    socket.on("connect", () => { tentativas = 0; });
    socket.on("disconnect", (motivo) => {
        if (motivo === "io server disconnect") agendar();
        else if (motivo === "io client disconnect") { clearTimeout(timer); timer = undefined; } // desmontou o componente: não reviver
    });
    socket.on("connect_error", () => { if (!socket.active) agendar(); });
    return () => { if (timer) clearTimeout(timer); };
}
