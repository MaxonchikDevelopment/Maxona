import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserIdFromRequest } from "@/lib/auth/session";

export async function PATCH(request: NextRequest) {
  const userId = await getSessionUserIdFromRequest(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const existing = (user.constraints ?? {}) as Record<string, unknown>;
  const updated = { ...existing, ...body };
  const result = await prisma.user.update({
    where: { id: userId },
    data: { constraints: updated },
  });
  return NextResponse.json(result.constraints);
}
