import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";

const PHONE_JID = /^(\d{8,15})(?::\d+)?@s\.whatsapp\.net$/;
const toPhone = (jid?: string | null): string | null => {
    const m = jid ? PHONE_JID.exec(jid) : null;
    return m ? m[1] : null;
};

interface Member {
    phone: string;
    name: string;
}

interface Item {
    id: string;
    name: string;
    sub?: string;
    color?: string;
    phones: string[];
    members?: Member[];
}

/** 5561999531848 -> +55 61 99953-1848 (nunca mostra IDs internos do WhatsApp). */
function formatPhone(phone: string): string {
    const m = /^55(\d{2})(9?\d{4})(\d{4})$/.exec(phone);
    return m ? `+55 ${m[1]} ${m[2]}-${m[3]}` : `+${phone}`;
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
    const nameOfPhone = new Map<string, string>();
    for (const c of contacts) {
        const phone = toPhone(c.jid) || toPhone(c.remoteJidAlt);
        if (!phone) continue;
        const display = c.name || c.verifiedName || c.notify;
        if (display && !nameOfPhone.has(phone)) nameOfPhone.set(phone, display);
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
            const named = c.name || c.verifiedName || c.notify;
            items.push({ id: phone, name: named || formatPhone(phone), sub: named ? formatPhone(phone) : undefined, phones: [phone] });
        }
    } else if (type === "labels") {
        const labels = await prisma.label.findMany({ where: { sessionId }, orderBy: { name: "asc" }, include: { chatLabels: { select: { chatJid: true } } } });
        items = labels.map(l => {
            const phones = uniq(l.chatLabels.map(cl => resolve(cl.chatJid)));
            const members = phones.map(phone => ({ phone, name: nameOfPhone.get(phone) || formatPhone(phone) }));
            return { id: l.id, name: l.name, color: l.colorHex, sub: `${phones.length} contatos com número`, phones, members };
        });
    } else if (type === "groups") {
        const groups = await prisma.group.findMany({ where: { sessionId: session.id }, orderBy: { subject: "asc" }, select: { jid: true, subject: true, participants: true } });
        items = groups.map(g => {
            const parts = Array.isArray(g.participants) ? (g.participants as any[]) : [];
            const phones = uniq(parts.map(p => resolve(p?.phoneNumber) || resolve(p?.id)));
            const members = phones.map(phone => ({ phone, name: nameOfPhone.get(phone) || formatPhone(phone) }));
            return { id: g.jid, name: g.subject || "Grupo sem nome", sub: `${phones.length} participantes com número`, phones, members };
        });
    } else {
        return NextResponse.json({ status: false, message: "type inválido" }, { status: 400 });
    }

    return NextResponse.json({ status: true, data: items });
}
