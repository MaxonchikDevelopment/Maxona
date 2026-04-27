import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const USER_ID = "user_maxon";

export async function GET() {
  const profile = await prisma.userTrainingProfile.findUnique({ where: { userId: USER_ID } });
  return NextResponse.json(profile ?? null);
}

export async function PATCH(request: Request) {
  const body = await request.json();

  const data: Record<string, unknown> = {};
  if (body.restingHr !== undefined) data.restingHr = body.restingHr ? Number(body.restingHr) : null;
  if (body.maxHr !== undefined) data.maxHr = body.maxHr ? Number(body.maxHr) : null;
  if (body.easyHrMin !== undefined) data.easyHrMin = body.easyHrMin ? Number(body.easyHrMin) : null;
  if (body.easyHrMax !== undefined) data.easyHrMax = body.easyHrMax ? Number(body.easyHrMax) : null;
  if (body.tempoHrMin !== undefined) data.tempoHrMin = body.tempoHrMin ? Number(body.tempoHrMin) : null;
  if (body.tempoHrMax !== undefined) data.tempoHrMax = body.tempoHrMax ? Number(body.tempoHrMax) : null;
  if (body.thresholdHr !== undefined) data.thresholdHr = body.thresholdHr ? Number(body.thresholdHr) : null;
  if (body.zoneMethod !== undefined) data.zoneMethod = body.zoneMethod;

  const profile = await prisma.userTrainingProfile.upsert({
    where: { userId: USER_ID },
    create: { userId: USER_ID, ...data },
    update: data,
  });

  return NextResponse.json(profile);
}
