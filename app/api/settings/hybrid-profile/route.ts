import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserIdFromRequest } from "@/lib/auth/session";

export async function GET(request: NextRequest) {
  const userId = await getSessionUserIdFromRequest(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const profile = await prisma.hybridRaceProfile.findUnique({ where: { userId } });
  return NextResponse.json(profile ?? null);
}

export async function PATCH(request: NextRequest) {
  const userId = await getSessionUserIdFromRequest(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();

  const data: Record<string, unknown> = {};
  if (body.defaultFormat !== undefined) data.defaultFormat = body.defaultFormat;
  if (body.includesRunningDefault !== undefined) data.includesRunningDefault = Boolean(body.includesRunningDefault);
  if (body.stationWorkSec !== undefined) data.stationWorkSec = Number(body.stationWorkSec) || 60;
  if (body.stationRestSec !== undefined) data.stationRestSec = Number(body.stationRestSec) || 20;
  if (body.defaultRounds !== undefined) data.defaultRounds = Number(body.defaultRounds) || 3;
  if (body.notes !== undefined) data.notes = body.notes?.trim() || null;

  const profile = await prisma.hybridRaceProfile.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });

  return NextResponse.json(profile);
}
