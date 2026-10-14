import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/api-auth";

/** DELETE /api/social/signatures/:id */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const r = await prisma.socialSignature.deleteMany({ where: { id, userId: user.id } });
    if (r.count !== 1) return NextResponse.json({ status: false, message: "Not found" }, { status: 404 });
    return NextResponse.json({ status: true });
}
