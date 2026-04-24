import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const USER_ID = "user_maxon";

export async function DELETE() {
  await prisma.stravaConnection.deleteMany({ where: { userId: USER_ID } });
  return NextResponse.json({ ok: true });
}
