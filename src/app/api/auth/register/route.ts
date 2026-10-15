import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { z } from "zod";

const registerSchema = z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(6),
});

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { email, password, name } = registerSchema.parse(body);

        // Check if registration is enabled
        const systemConfig = await prisma.systemConfig.findUnique({ where: { id: "default" } });
        // @ts-ignore
        if (systemConfig && systemConfig.enableRegistration === false) {
            return NextResponse.json(
                { error: "O cadastro está desativado no momento pelo administrador" },
                { status: 403 }
            );
        }

        // Check if user already exists
        const existingUser = await prisma.user.findUnique({
            where: { email },
        });

        if (existingUser) {
            return NextResponse.json(
                { error: "Já existe um usuário com este e-mail" },
                { status: 400 }
            );
        }

        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create the user
        const newUser = await prisma.user.create({
            data: {
                name,
                email,
                password: hashedPassword,
                plan: "TRIAL",
                trialEndsAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
            },
        });

        return NextResponse.json({
            success: true,
            message: "Usuário cadastrado com sucesso",
            user: { id: newUser.id, name: newUser.name, email: newUser.email },
        });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return NextResponse.json(
                { error: "Dados de cadastro inválidos" },
                { status: 400 }
            );
        }

        console.error("Registration error:", error);
        return NextResponse.json(
            { error: "Erro interno ao realizar o cadastro" },
            { status: 500 }
        );
    }
}
