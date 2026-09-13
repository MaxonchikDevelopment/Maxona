import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserIdFromRequest } from "@/lib/auth/session";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getSessionUserIdFromRequest(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { title, description, discipline, targetDate, priority } = await request.json();

  if (!title?.trim()) {
    return NextResponse.json({ error: "Title required" }, { status: 400 });
  }
  if (title.trim().length > 200) {
    return NextResponse.json({ error: "Title too long (max 200 chars)" }, { status: 400 });
  }
  if (typeof description === "string" && description.length > 2000) {
    return NextResponse.json({ error: "Description too long (max 2000 chars)" }, { status: 400 });
  }

  const { count } = await prisma.goal.updateMany({
    where: { id, userId },
    data: {
      title: title.trim(),
      description: description?.trim() || null,
      discipline: discipline?.trim() || null,
      targetDate: targetDate ? new Date(targetDate) : null,
      priority: priority != null ? Number(priority) : null,
    },
  });
  if (count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const goal = await prisma.goal.findUniqueOrThrow({ where: { id } });
  return NextResponse.json(goal);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getSessionUserIdFromRequest(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  await prisma.goal.updateMany({
    where: { id, userId },
    data: { deletedAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
