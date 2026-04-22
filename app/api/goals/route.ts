import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const USER_ID = "user_maxon";

export async function GET() {
  const goals = await prisma.goal.findMany({
    where: { userId: USER_ID, deletedAt: null },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(goals);
}

export async function POST(request: Request) {
  const { title, description, discipline, targetDate, priority } = await request.json();
  if (!title?.trim()) {
    return NextResponse.json({ error: "Title required" }, { status: 400 });
  }
  const goal = await prisma.goal.create({
    data: {
      userId: USER_ID,
      title: title.trim(),
      description: description?.trim() || null,
      discipline: discipline?.trim() || null,
      targetDate: targetDate ? new Date(targetDate) : null,
      priority: priority != null ? Number(priority) : null,
    },
  });
  return NextResponse.json(goal, { status: 201 });
}
