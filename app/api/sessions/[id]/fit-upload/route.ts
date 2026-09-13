import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserIdFromRequest } from "@/lib/auth/session";
import { computeSessionMetrics } from "@/lib/analytics/run-metrics";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getSessionUserIdFromRequest(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const session = await prisma.trainingSession.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!session) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  const fitBuffer = Buffer.from(await file.arrayBuffer());

  let metrics;
  try {
    metrics = computeSessionMetrics(fitBuffer);
  } catch {
    return NextResponse.json({ error: "Could not parse FIT file" }, { status: 400 });
  }

  const saved = await prisma.sessionMetrics.upsert({
    where: { sessionId: id },
    create: {
      sessionId: id,
      source: metrics.source,
      movingTimeSec: metrics.movingTimeSec,
      elapsedTimeSec: metrics.elapsedTimeSec,
      pauses: metrics.pauses,
      distanceKm: metrics.distanceKm,
      avgHr: metrics.avgHr,
      efWhole: metrics.efWhole,
      efFirstHalf: metrics.efFirstHalf,
      efSecondHalf: metrics.efSecondHalf,
      decouplingPct: metrics.decouplingPct,
      decouplingValid: metrics.decouplingValid,
      zoneShare: metrics.zoneShare ?? undefined,
      cadenceSpm: metrics.cadenceSpm,
      powerAvg: metrics.powerAvg,
    },
    update: {
      source: metrics.source,
      movingTimeSec: metrics.movingTimeSec,
      elapsedTimeSec: metrics.elapsedTimeSec,
      pauses: metrics.pauses,
      distanceKm: metrics.distanceKm,
      avgHr: metrics.avgHr,
      efWhole: metrics.efWhole,
      efFirstHalf: metrics.efFirstHalf,
      efSecondHalf: metrics.efSecondHalf,
      decouplingPct: metrics.decouplingPct,
      decouplingValid: metrics.decouplingValid,
      zoneShare: metrics.zoneShare ?? undefined,
      cadenceSpm: metrics.cadenceSpm,
      powerAvg: metrics.powerAvg,
    },
  });

  return NextResponse.json(saved);
}
