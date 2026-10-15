import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, isAdmin } from "@/lib/api-auth";
import bcrypt from "bcryptjs";
import { lerCorpo } from "@/lib/validate";
import { z } from "zod";

// campos fora da lista (plano inválido, extraSessions fora de 0 a 50) continuam sendo ignorados, como antes
const schema = z.object({
    name: z.string().optional(),
    email: z.string().email("e-mail inválido").optional(),
    password: z.string().min(6, "a senha precisa ter ao menos 6 caracteres").optional(),
    role: z.enum(["SUPERADMIN", "OWNER", "STAFF"], { error: "use SUPERADMIN, OWNER ou STAFF" }).optional(),
    plan: z.string().optional(),
    planStatus: z.string().optional(),
    extraSessions: z.number().optional(),
});

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = await getAuthenticatedUser(request);

    // Only SUPERADMIN can update users
    if (!user || !isAdmin(user.role)) {
        return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 403 });
    }

    const { id } = await params;

    try {
        const lido = await lerCorpo(request, schema);
        if (!lido.ok) return lido.response;
        const { name, email, password, role, plan, planStatus, extraSessions } = lido.data;

        // Prevent modifying own role to lock oneself out (optional safety)
        if (id === user.id && role && role !== "SUPERADMIN") {
            // Allow update but maybe warn? For now let it be.
        }

        const updateData: any = {};
        if (name) updateData.name = name;
        if (email) updateData.email = email;
        if (role) updateData.role = role;
        if (plan && ["TRIAL", "ESSENCIAL", "PRO", "ESCALA", "ILIMITADO"].includes(plan)) {
            updateData.plan = plan;
            if (plan === "TRIAL") updateData.trialEndsAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
            else updateData.trialEndsAt = null;
        }
        if (planStatus === "ACTIVE" || planStatus === "SUSPENDED") updateData.planStatus = planStatus;
        if (extraSessions !== undefined && Number.isInteger(extraSessions) && extraSessions >= 0 && extraSessions <= 50) updateData.extraSessions = extraSessions;
        if (password) {
            updateData.password = await bcrypt.hash(password, 10);
        }

        const updatedUser = await prisma.user.update({
            where: { id },
            data: updateData,
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                plan: true,
                planStatus: true,
                extraSessions: true,
                updatedAt: true
            }
        });

        return NextResponse.json({ status: true, message: "User updated successfully", data: updatedUser });

    } catch (error) {
        console.error("Update user error:", error);
        return NextResponse.json({ status: false, message: "Failed to update user", error: "Failed to update user" }, { status: 500 });
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = await getAuthenticatedUser(request);

    // Only SUPERADMIN can delete users
    if (!user || !isAdmin(user.role)) {
        return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 403 });
    }

    const { id } = await params;

    if (id === user.id) {
        return NextResponse.json({ status: false, message: "Cannot delete yourself", error: "Cannot delete yourself" }, { status: 400 });
    }

    try {
        await prisma.user.delete({ where: { id } });
        return NextResponse.json({ status: true, message: "User deleted successfully" });
    } catch (error) {
        console.error("Delete user error:", error);
        return NextResponse.json({ status: false, message: "Failed to delete user", error: "Failed to delete user" }, { status: 500 });
    }
}
