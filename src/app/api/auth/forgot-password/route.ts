import { NextRequest, NextResponse } from "next/server";
import { createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { sendMail, resetPasswordMail } from "@/lib/mailer";

const RESET_TTL_MS = 60 * 60 * 1000; // 1 hora
const MAX_PER_HOUR = 3;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Pede o link de redefinição de senha. A resposta é sempre a mesma, exista ou não a conta,
 * para não revelar quais e-mails estão cadastrados.
 */
export async function POST(request: NextRequest) {
    const generic = NextResponse.json({
        status: true,
        message: "Se esse e-mail tiver uma conta, enviamos um link para criar uma nova senha.",
    });

    try {
        const body = await request.json().catch(() => ({}));
        const email = String(body?.email || "").trim().toLowerCase();
        if (!email || !email.includes("@") || email.length > 200) return generic;

        const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
        if (!user) return generic;

        // limite: no máximo 3 pedidos por hora para a mesma conta
        const recent = await prisma.passwordReset.count({
            where: { userId: user.id, createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) } },
        });
        if (recent >= MAX_PER_HOUR) return generic;

        const token = randomBytes(32).toString("hex");
        await prisma.passwordReset.create({
            data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) },
        });

        const base = (process.env.BASE_URL || process.env.NEXTAUTH_URL || request.nextUrl.origin).replace(/\/$/, "");
        const link = `${base}/auth/reset-password?token=${token}`;
        await sendMail({ to: email, ...resetPasswordMail(link) });

        return generic;
    } catch (error) {
        console.error("Forgot password error:", error);
        return generic;
    }
}
