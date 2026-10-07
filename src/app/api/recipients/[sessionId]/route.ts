import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";

const PHONE_JID = /^(\d{8,15})(?::\d+)?@s\.whatsapp\.net$/;
const toPhone = (jid?: string | null): string | null => {
    const m = jid ? PHONE_JID.exec(jid) : null;
    return m ? m[1] : null;
};

interface Item {
    id: string;
    name: string;
    sub?: string;
    color?: string;
    phones: string[];
}

/**
 * GET /api/recipients/:sessionId?type=contacts|labels|groups
 * Devolve listas prontas para o seletor de destinatários do Disparo: cada item traz os telefones
 * (JIDs "@lid" são convertidos para número usando a agenda sincronizada; sem número, ficam de fora).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
    const user = await getAuthenticatedUser(req);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });

    const { sessionId } = await params;
    if (!(await canAccessSession(user.id, user.role, sessionId))) return NextResponse.json({ status: false, message: "Forbidden" }, { status: 403 });

    const type = new URL(req.url).searchParams.get("type");
    const session = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
    if (!session) return NextResponse.json({ status: false, message: "Session not found" }, { status: 404 });

    const contacts = await prisma.contact.findMany({
        where: { sessionId: session.id },
        select: { jid: true, lid: true, name: true, notify: true, verifiedName: true, remoteJidAlt: true },
        orderBy: { name: "asc" },
    });

    // jid/lid -> telefone
    const phoneOf = new Map<string, string>();
    for (const c of contacts) {
        const phone = toPhone(c.jid) || toPhone(c.remoteJidAlt);
        if (!phone) continue;
        phoneOf.set(c.jid, phone);
        if (c.lid) phoneOf.set(c.lid, phone);
        if (c.remoteJidAlt) phoneOf.set(c.remoteJidAlt, phone);
    }
    const resolve = (jid?: string | null): string | null => (jid ? toPhone(jid) || phoneOf.get(jid) || null : null);
    const uniq = (list: (string | null)[]) => Array.from(new Set(list.filter((p): p is string => !!p)));

    let items: Item[] = [];

    if (type === "contacts") {
        const seen = new Set<string>();
        for (const c of contacts) {
            const phone = toPhone(c.jid) || toPhone(c.remoteJidAlt);
            if (!phone || seen.has(phone)) continue;
            seen.add(phone);
            items.push({ id: phone, name: c.name || c.verifiedName || c.notify || phone, sub: phone, phones: [phone] });
        }
    } else if (type === "labels") {
        const labels = await prisma.label.findMany({ where: { sessionId }, orderBy: { name: "asc" }, include: { chatLabels: { select: { chatJid: true } } } });
        items = labels.map(l => {
            const phones = uniq(l.chatLabels.map(cl => resolve(cl.chatJid)));
            return { id: l.id, name: l.name, color: l.colorHex, sub: `${phones.length} contatos`, phones };
        });
    } else if (type === "groups") {
        const groups = await prisma.group.findMany({ where: { sessionId: session.id }, orderBy: { subject: "asc" }, select: { jid: true, subject: true, participants: true } });
        items = groups.map(g => {
            const parts = Array.isArray(g.participants) ? (g.participants as any[]) : [];
            const phones = uniq(parts.map(p => resolve(p?.phoneNumber) || resolve(p?.id)));
            return { id: g.jid, name: g.subject || g.jid, sub: `${phones.length} participantes`, phones };
        });
    } else {
        return NextResponse.json({ status: false, message: "type inválido" }, { status: 400 });
    }

    return NextResponse.json({ status: true, data: items });
}
