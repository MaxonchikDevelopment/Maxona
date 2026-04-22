import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const USER_ID = "user_maxon";

export async function PATCH(request: Request) {
  const body = await request.json();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: USER_ID } });
  const existing = (user.constraints ?? {}) as Record<string, unknown>;
  const updated = { ...existing, ...body };
  const result = await prisma.user.update({
    where: { id: USER_ID },
    data: { constraints: updated },
  });
  return NextResponse.json(result.constraints);
}
