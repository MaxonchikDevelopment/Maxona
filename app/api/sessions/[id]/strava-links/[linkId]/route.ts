import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const USER_ID = "user_maxon";

// Detach an activity link
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; linkId: string }> }
) {
  const { id, linkId } = await params;
  const session = await prisma.trainingSession.findFirst({ where: { id, userId: USER_ID } });
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.sessionStravaActivityLink.deleteMany({
    where: { id: linkId, sessionId: id },
  });
  return NextResponse.json({ ok: true });
}

// Toggle isPrimary — sets this link as primary, demotes others
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; linkId: string }> }
) {
  const { id, linkId } = await params;
  const { isPrimary } = await request.json();

  const session = await prisma.trainingSession.findFirst({ where: { id, userId: USER_ID } });
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (isPrimary) {
    await prisma.sessionStravaActivityLink.updateMany({
      where: { sessionId: id, isPrimary: true },
      data: { isPrimary: false },
    });
  }

  const updated = await prisma.sessionStravaActivityLink.update({
    where: { id: linkId },
    data: { isPrimary: !!isPrimary },
    include: { activity: true },
  });

  return NextResponse.json(updated);
}
