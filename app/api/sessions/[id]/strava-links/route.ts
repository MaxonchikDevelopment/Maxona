import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserIdFromRequest } from "@/lib/auth/session";

// List links for a session
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getSessionUserIdFromRequest(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const session = await prisma.trainingSession.findFirst({ where: { id, userId } });
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const links = await prisma.sessionStravaActivityLink.findMany({
    where: { sessionId: id },
    include: { activity: true },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(links);
}

// Attach a Strava activity to a session
// Body: { stravaActivityId: string, isPrimary?: boolean }
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getSessionUserIdFromRequest(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { stravaActivityId, isPrimary = false } = await request.json();

  if (!stravaActivityId) {
    return NextResponse.json({ error: "stravaActivityId required" }, { status: 400 });
  }

  const [session, activity] = await Promise.all([
    prisma.trainingSession.findFirst({ where: { id, userId } }),
    prisma.stravaActivity.findUnique({ where: { id: stravaActivityId } }),
  ]);

  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  // Check activity exists and belongs to this user (prevents cross-user activity linking)
  if (!activity || activity.userId !== userId) {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  }

  if (isPrimary) {
    await prisma.sessionStravaActivityLink.updateMany({
      where: { sessionId: id, isPrimary: true },
      data: { isPrimary: false },
    });
  }

  const link = await prisma.sessionStravaActivityLink.upsert({
    where: { sessionId_stravaActivityId: { sessionId: id, stravaActivityId } },
    create: { sessionId: id, stravaActivityId, isPrimary },
    update: { isPrimary },
    include: { activity: true },
  });

  return NextResponse.json(link, { status: 201 });
}
