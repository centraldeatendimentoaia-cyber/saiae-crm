import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { addOptOut, removeOptOut } from "@/lib/optout";
import { normalizePhone } from "@/lib/phone";

async function guard(request: NextRequest, sessionId: string) {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
    if (!(await canAccessSession(user.id, user.role, sessionId))) return NextResponse.json({ status: false, message: "Forbidden" }, { status: 403 });
    return null;
}

/** GET: lista de descadastrados do número (com o nome do contato, quando existe). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
    const { sessionId } = await params;
    const denied = await guard(request, sessionId);
    if (denied) return denied;

    const rows = await prisma.optOut.findMany({ where: { sessionId }, orderBy: { createdAt: "desc" }, take: 2000 });
    const session = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
    const contacts = session && rows.length
        ? await prisma.contact.findMany({ where: { sessionId: session.id, jid: { in: rows.map(r => r.jid) } }, select: { jid: true, name: true, notify: true } })
        : [];
    const names = new Map(contacts.map(c => [c.jid, c.name || c.notify || null]));

    return NextResponse.json({
        status: true,
        data: rows.map(r => ({ id: r.id, jid: r.jid, phone: r.jid.split("@")[0], name: names.get(r.jid) || null, createdAt: r.createdAt })),
    });
}

/** POST { phones: string[] }: adiciona números à lista (ex.: pedido de descadastro recebido por outro canal). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
    const { sessionId } = await params;
    const denied = await guard(request, sessionId);
    if (denied) return denied;

    const body = await request.json().catch(() => ({}));
    const phones: string[] = Array.isArray(body.phones) ? body.phones : [];
    let added = 0;
    for (const raw of phones) {
        const n = normalizePhone(String(raw));
        if (!n) continue;
        await addOptOut(sessionId, `${n}@s.whatsapp.net`);
        added++;
    }
    return NextResponse.json({ status: true, data: { added } });
}

/** DELETE { id } ou { all: true }: devolve o contato (ou todos) à lista de envio. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
    const { sessionId } = await params;
    const denied = await guard(request, sessionId);
    if (denied) return denied;

    const body = await request.json().catch(() => ({}));
    if (body.all === true) {
        const r = await prisma.optOut.deleteMany({ where: { sessionId } });
        return NextResponse.json({ status: true, data: { removed: r.count } });
    }
    if (typeof body.id === "string") {
        const row = await prisma.optOut.findFirst({ where: { id: body.id, sessionId } });
        if (row) await removeOptOut(sessionId, row.jid);
        return NextResponse.json({ status: true, data: { removed: row ? 1 : 0 } });
    }
    return NextResponse.json({ status: false, message: "Informe id ou all" }, { status: 400 });
}
