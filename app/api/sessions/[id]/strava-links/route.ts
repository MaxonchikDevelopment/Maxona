import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const USER_ID = "user_maxon";

// List links for a session
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await prisma.trainingSession.findFirst({ where: { id, userId: USER_ID } });
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
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { stravaActivityId, isPrimary = false } = await request.json();

  if (!stravaActivityId) {
    return NextResponse.json({ error: "stravaActivityId required" }, { status: 400 });
  }

  const [session, activity] = await Promise.all([
    prisma.trainingSession.findFirst({ where: { id, userId: USER_ID } }),
    prisma.stravaActivity.findUnique({ where: { id: stravaActivityId } }),
  ]);

  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  if (!activity) return NextResponse.json({ error: "Activity not found" }, { status: 404 });

  // If marking as primary, demote any existing primary first
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
