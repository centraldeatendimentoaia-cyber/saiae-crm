import { EventEmitter } from "events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reconectarComEspera } from "./socket-reconectar";

const falso = () => Object.assign(new EventEmitter(), { active: false, connect: vi.fn() });

describe("reconectarComEspera", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("reconecta após queda iniciada pelo servidor, com espera crescente e teto", () => {
        const s = falso();
        reconectarComEspera(s as never, 1000, 3000);
        s.emit("disconnect", "io server disconnect");
        vi.advanceTimersByTime(999); expect(s.connect).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1); expect(s.connect).toHaveBeenCalledTimes(1);
        s.emit("connect_error", new Error("unauthorized"));
        vi.advanceTimersByTime(1999); expect(s.connect).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(1); expect(s.connect).toHaveBeenCalledTimes(2);
        s.emit("connect_error", new Error("unauthorized")); // 4000 vira teto 3000
        vi.advanceTimersByTime(3000); expect(s.connect).toHaveBeenCalledTimes(3);
    });
    it("queda por outro motivo não agenda (o cliente já reconecta sozinho) e conectar zera a espera", () => {
        const s = falso();
        reconectarComEspera(s as never, 1000, 8000);
        s.emit("disconnect", "transport close");
        vi.advanceTimersByTime(10_000); expect(s.connect).not.toHaveBeenCalled();
        s.emit("connect_error", new Error("x")); vi.advanceTimersByTime(1000);
        s.emit("connect"); s.emit("connect_error", new Error("x")); vi.advanceTimersByTime(1000);
        expect(s.connect).toHaveBeenCalledTimes(2);
    });
    it("disconnect manual do cliente cancela a espera pendente", () => {
        const s = falso();
        reconectarComEspera(s as never, 1000);
        s.emit("connect_error", new Error("x"));
        s.emit("disconnect", "io client disconnect");
        vi.advanceTimersByTime(5000); expect(s.connect).not.toHaveBeenCalled();
    });
    it("não agenda duas vezes e o cleanup cancela", () => {
        const s = falso();
        const parar = reconectarComEspera(s as never, 1000);
        s.emit("connect_error", new Error("x")); s.emit("connect_error", new Error("x"));
        parar();
        vi.advanceTimersByTime(5000); expect(s.connect).not.toHaveBeenCalled();
    });
});
