import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { generateApiKey, hashApiKey, apiKeyHint } from "@/lib/api-key";

// Get current user's API key (só mascarada: a chave completa é mostrada apenas na criação)
export async function GET() {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });

    try {
        const user = await prisma.user.findUnique({
            where: { id: session.user.id },
            select: { apiKey: true, apiKeyHint: true }
        });

        // Chave legada (texto puro) ainda não migrada: mostra só a máscara, nunca o valor.
        const masked = user?.apiKeyHint || (user?.apiKey ? apiKeyHint(user.apiKey) : null);
        return NextResponse.json({ status: true, message: "API key fetched", data: { apiKey: masked, hasApiKey: !!masked } });
    } catch (error) {
        return NextResponse.json({ status: false, message: "Failed to fetch API key", error: "Failed to fetch API key" }, { status: 500 });
    }
}

// Generate new API key
export async function POST() {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });

    try {
        const newApiKey = generateApiKey();

        await prisma.user.update({
            where: { id: session.user.id },
            data: { apiKey: null, apiKeyHash: hashApiKey(newApiKey), apiKeyHint: apiKeyHint(newApiKey) }
        });

        return NextResponse.json({ status: true, message: "API key generated", data: { apiKey: newApiKey } });
    } catch (error) {
        console.error("Generate API key error:", error);
        return NextResponse.json({ status: false, message: "Failed to generate API key", error: "Failed to generate API key" }, { status: 500 });
    }
}

// Delete/revoke API key
export async function DELETE() {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });

    try {
        await prisma.user.update({
            where: { id: session.user.id },
            data: { apiKey: null, apiKeyHash: null, apiKeyHint: null }
        });

        return NextResponse.json({ status: true, message: "API key revoked" });
    } catch (error) {
        return NextResponse.json({ status: false, message: "Failed to revoke API key", error: "Failed to revoke API key" }, { status: 500 });
    }
}
