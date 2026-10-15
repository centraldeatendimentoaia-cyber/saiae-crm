import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { lerCorpo } from "@/lib/validate";
import { z } from "zod";

const schema = z.object({
    appName: z.string().min(1, "informe o nome do app").max(100).optional(),
    logoUrl: z.string().nullish(),
    faviconUrl: z.string().nullish(),
    timezone: z.string().min(1).optional(),
    enableRegistration: z.boolean().nullish(),
});

export async function GET(request: NextRequest) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        // @ts-ignore
        const config = await prisma.systemConfig.findUnique({
            where: { id: "default" }
        });

        return NextResponse.json({ status: true, message: "System config fetched", data: config || { appName: "Saiaê", faviconUrl: "/favicon.ico" } });
    } catch (error) {
        return NextResponse.json({ status: false, message: "Failed to fetch settings", error: "Failed to fetch settings" }, { status: 500 });
    }
}

export async function POST(req: Request) {
    try {
        // @ts-ignore
        const user = await getAuthenticatedUser(req);
        if (!user || user.role !== "SUPERADMIN") {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const lido = await lerCorpo(req, schema);
        if (!lido.ok) return lido.response;
        const { appName, logoUrl, faviconUrl, timezone, enableRegistration } = lido.data;

        // @ts-ignore
        const config = await prisma.systemConfig.upsert({
            where: { id: "default" },
            update: { appName, logoUrl, faviconUrl, timezone, enableRegistration: enableRegistration ?? true },
            create: { id: "default", appName, logoUrl: logoUrl || "", faviconUrl: faviconUrl || "/favicon.ico", timezone: timezone || "America/Sao_Paulo", enableRegistration: enableRegistration ?? true }
        });

        return NextResponse.json({ status: true, message: "System settings updated", data: config });
    } catch (error) {
        return NextResponse.json({ status: false, message: "Failed to update settings", error: "Failed to update settings" }, { status: 500 });
    }
}
