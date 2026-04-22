import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const USER_ID = "user_maxon";

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await prisma.goal.updateMany({
    where: { id, userId: USER_ID },
    data: { deletedAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
