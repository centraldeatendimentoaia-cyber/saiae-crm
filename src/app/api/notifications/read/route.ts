
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { lerCorpo, opt } from "@/lib/validate";
import { z } from "zod";

const schema = z.object({ ids: opt(z.array(z.string())) });

export async function PATCH(req: Request) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });

    try {
        // ids vazio ou ausente marca todas como lidas
        const lido = await lerCorpo(req, schema);
        if (!lido.ok) return lido.response;
        const { ids } = lido.data;

        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            // If no IDs provided, mark ALL as read for this user
            await prisma.notification.updateMany({
                where: { userId: session.user.id, read: false },
                data: { read: true }
            });
        } else {
            await prisma.notification.updateMany({
                where: {
                    userId: session.user.id,
                    id: { in: ids }
                },
                data: { read: true }
            });
        }

        return NextResponse.json({ status: true, message: "Notifications marked as read" });
    } catch (e) {
        console.error(e);
        return NextResponse.json({ status: false, message: "Error updating notifications", error: "Error updating notifications" }, { status: 500 });
    }
}
