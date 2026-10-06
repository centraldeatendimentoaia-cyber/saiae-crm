import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";

const PHONE_JID = /^(\d{8,15})(?::\d+)?@s\.whatsapp\.net$/;

function toPhone(jid?: string | null): string | null {
    const m = jid ? PHONE_JID.exec(jid) : null;
    return m ? m[1] : null;
}

function csvCell(v: string): string {
    return /[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * Exporta os contatos da sessão (somente os que têm número de telefone).
 * ?format=csv (padrão) baixa um CSV para Excel; ?format=txt devolve um número por linha
 * (pronto para colar em Disparo). ?search= aplica o mesmo filtro da tela.
 */
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    try {
        const user = await getAuthenticatedUser(req);
        if (!user) {
            return NextResponse.json({ status: false, error: "Unauthorized" }, { status: 401 });
        }

        const { sessionId } = await params;
        const { searchParams } = new URL(req.url);
        const format = searchParams.get("format") === "txt" ? "txt" : "csv";
        const search = searchParams.get("search") || "";

        if (!(await canAccessSession(user.id, user.role, sessionId))) {
            return NextResponse.json({ status: false, error: "Forbidden" }, { status: 403 });
        }

        const sessionData = await prisma.session.findUnique({
            where: { sessionId },
            select: { id: true },
        });
        if (!sessionData) {
            return NextResponse.json({ status: false, error: "Session not found" }, { status: 404 });
        }

        const where: any = { sessionId: sessionData.id };
        if (search) {
            where.OR = [
                { name: { contains: search } },
                { notify: { contains: search } },
                { verifiedName: { contains: search } },
                { jid: { contains: search } },
                { remoteJidAlt: { contains: search } },
            ];
        }

        const contacts = await prisma.contact.findMany({
            where,
            orderBy: { name: "asc" },
            select: { jid: true, name: true, notify: true, verifiedName: true, remoteJidAlt: true },
        });

        const seen = new Set<string>();
        const rows: { name: string; phone: string }[] = [];
        for (const c of contacts) {
            const phone = toPhone(c.jid) || toPhone(c.remoteJidAlt);
            if (!phone || seen.has(phone)) continue;
            seen.add(phone);
            rows.push({ name: c.name || c.verifiedName || c.notify || "", phone });
        }

        if (format === "txt") {
            return new NextResponse(rows.map((r) => r.phone).join("\n"), {
                headers: { "Content-Type": "text/plain; charset=utf-8", "X-Total": String(rows.length) },
            });
        }

        // BOM + ";" para o Excel em português abrir com acentos e colunas corretas
        const csv =
            "﻿" +
            ["Nome;Telefone", ...rows.map((r) => `${csvCell(r.name)};${r.phone}`)].join("\r\n");
        return new NextResponse(csv, {
            headers: {
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": `attachment; filename="contatos-${sessionId}.csv"`,
                "X-Total": String(rows.length),
            },
        });
    } catch (error) {
        console.error("Export contacts error", error);
        return NextResponse.json({ status: false, error: "Internal Server Error" }, { status: 500 });
    }
}
