import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserIdFromRequest } from "@/lib/auth/session";

export async function GET(request: NextRequest) {
  const userId = await getSessionUserIdFromRequest(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const goals = await prisma.goal.findMany({
    where: { userId, deletedAt: null },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(goals);
}

export async function POST(request: NextRequest) {
  const userId = await getSessionUserIdFromRequest(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
  const goal = await prisma.goal.create({
    data: {
      userId,
      title: title.trim(),
      description: description?.trim() || null,
      discipline: discipline?.trim() || null,
      targetDate: targetDate ? new Date(targetDate) : null,
      priority: priority != null ? Number(priority) : null,
    },
  });
  return NextResponse.json(goal, { status: 201 });
}
