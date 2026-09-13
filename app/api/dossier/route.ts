import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserIdFromRequest } from "@/lib/auth/session";
import type { Prisma } from "@prisma/client";

export async function GET(request: NextRequest) {
  const userId = await getSessionUserIdFromRequest(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const dossier = await prisma.athleteDossier.findUnique({ where: { userId } });
  if (!dossier) {
    return NextResponse.json({ facts: {}, version: 0 });
  }

  return NextResponse.json({ facts: dossier.facts, version: dossier.version });
}

export async function PUT(request: NextRequest) {
  const userId = await getSessionUserIdFromRequest(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const b = body as Record<string, unknown> | null;
  if (!b || typeof b !== "object" || typeof b.facts !== "object" || b.facts === null || Array.isArray(b.facts)) {
    return NextResponse.json({ error: "facts must be a JSON object" }, { status: 400 });
  }
  const facts = b.facts as Prisma.InputJsonValue;

  const existing = await prisma.athleteDossier.findUnique({ where: { userId } });

  const dossier = existing
    ? await prisma.athleteDossier.update({
        where: { userId },
        data: { facts, version: existing.version + 1 },
      })
    : await prisma.athleteDossier.create({
        data: { userId, facts, version: 1 },
      });

  return NextResponse.json({ facts: dossier.facts, version: dossier.version });
}
