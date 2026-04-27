import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const USER_ID = "user_maxon";

export async function GET() {
  const profile = await prisma.hybridRaceProfile.findUnique({ where: { userId: USER_ID } });
  return NextResponse.json(profile ?? null);
}

export async function PATCH(request: Request) {
  const body = await request.json();

  const data: Record<string, unknown> = {};
  if (body.defaultFormat !== undefined) data.defaultFormat = body.defaultFormat;
  if (body.includesRunningDefault !== undefined) data.includesRunningDefault = Boolean(body.includesRunningDefault);
  if (body.stationWorkSec !== undefined) data.stationWorkSec = Number(body.stationWorkSec) || 60;
  if (body.stationRestSec !== undefined) data.stationRestSec = Number(body.stationRestSec) || 20;
  if (body.defaultRounds !== undefined) data.defaultRounds = Number(body.defaultRounds) || 3;
  if (body.notes !== undefined) data.notes = body.notes?.trim() || null;

  const profile = await prisma.hybridRaceProfile.upsert({
    where: { userId: USER_ID },
    create: { userId: USER_ID, ...data },
    update: data,
  });

  return NextResponse.json(profile);
}
