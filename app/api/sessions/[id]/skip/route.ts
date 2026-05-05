import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserIdFromRequest } from "@/lib/auth/session";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getSessionUserIdFromRequest(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const session = await prisma.trainingSession.findFirst({
    where: { id, userId },
    select: { id: true, status: true },
  });

  if (!session) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (session.status !== "planned") {
    return NextResponse.json({ id: session.id, status: session.status });
  }

  const updated = await prisma.trainingSession.update({
    where: { id },
    data: { status: "skipped" },
    select: { id: true, status: true },
  });

  return NextResponse.json(updated);
}
