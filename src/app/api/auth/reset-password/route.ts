import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Define a nova senha a partir do link enviado por e-mail. */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}));
        const token = String(body?.token || "");
        const password = String(body?.password || "");

        if (token.length < 32 || token.length > 128) {
            return NextResponse.json({ status: false, message: "Link inválido." }, { status: 400 });
        }
        if (password.length < 8 || password.length > 100) {
            return NextResponse.json({ status: false, message: "A senha precisa ter de 8 a 100 caracteres." }, { status: 400 });
        }

        const reset = await prisma.passwordReset.findUnique({ where: { tokenHash: hashToken(token) } });
        if (!reset || reset.usedAt || reset.expiresAt < new Date()) {
            return NextResponse.json({ status: false, message: "Este link expirou ou já foi usado. Peça um novo." }, { status: 400 });
        }

        const hashed = await bcrypt.hash(password, 10);
        await prisma.$transaction([
            prisma.user.update({ where: { id: reset.userId }, data: { password: hashed } }),
            // invalida este e qualquer outro link pendente da conta
            prisma.passwordReset.updateMany({ where: { userId: reset.userId, usedAt: null }, data: { usedAt: new Date() } }),
        ]);

        return NextResponse.json({ status: true, message: "Senha alterada com sucesso." });
    } catch (error) {
        console.error("Reset password error:", error);
        return NextResponse.json({ status: false, message: "Não foi possível alterar a senha." }, { status: 500 });
    }
}
