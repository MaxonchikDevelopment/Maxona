import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserIdFromRequest } from "@/lib/auth/session";
import type {
  TimeSlot,
  SessionPlanningType,
  SessionIntensity,
  SessionModality,
  Prisma,
} from "@prisma/client";

const SLOTS: TimeSlot[] = ["morning", "daytime", "afternoon", "evening"];
const PLANNING_TYPES: SessionPlanningType[] = ["fixed", "preferred", "generated", "manual"];
const INTENSITIES: SessionIntensity[] = ["easy", "moderate", "hard"];
const MODALITIES: SessionModality[] = ["hyrox", "running", "cycling", "swimming"];
const EVALUATION_MODES = ["measurable_milestone", "descriptive_post_hoc"] as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface ImportedWorkoutBlock {
  label: string;
  durationMin: number;
  description: string;
  hrRange?: { min: number; max: number } | null;
  paceRange?: { min: string; max: string } | null;
  distanceKm?: number | null;
  cue?: string | null;
  equipment?: string[] | null;
}

interface ImportedSession {
  date: string;
  preferredSlot: TimeSlot;
  planningType: SessionPlanningType;
  durationMin: number;
  intensity: SessionIntensity;
  notes?: string;
  workoutPlan?: {
    planType: string;
    goal: string;
    target?: string | null;
    blocks: ImportedWorkoutBlock[];
    generalRules: string[];
    successCriteria?: string[] | null;
    fallbackCriteria?: string[] | null;
    alternatives?: string[] | null;
    summary?: string | null;
    rationale: string;
    evaluationMode: (typeof EVALUATION_MODES)[number];
  };
}

interface ImportedFixedSession {
  date: string;
  preferredSlot: TimeSlot;
  durationMin: number;
  intensity?: SessionIntensity;
  modality: SessionModality;
  notes?: string;
}

interface WeeklyPlanImport {
  weekStart: string;
  weekEnd: string;
  blockLabel?: string;
  blockPhase?: string;
  focusSummary?: string;
  sessions: ImportedSession[];
  fixedSessions?: ImportedFixedSession[];
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function validateBody(body: unknown): { error: string } | { value: WeeklyPlanImport } {
  if (!body || typeof body !== "object") return { error: "Body must be an object" };
  const b = body as Record<string, unknown>;

  if (typeof b.weekStart !== "string" || !DATE_RE.test(b.weekStart)) {
    return { error: "weekStart must be a YYYY-MM-DD string" };
  }
  if (typeof b.weekEnd !== "string" || !DATE_RE.test(b.weekEnd)) {
    return { error: "weekEnd must be a YYYY-MM-DD string" };
  }
  if (b.blockLabel !== undefined && typeof b.blockLabel !== "string") {
    return { error: "blockLabel must be a string" };
  }
  if (b.blockPhase !== undefined && typeof b.blockPhase !== "string") {
    return { error: "blockPhase must be a string" };
  }
  if (b.focusSummary !== undefined && typeof b.focusSummary !== "string") {
    return { error: "focusSummary must be a string" };
  }
  if (!Array.isArray(b.sessions) || b.sessions.length === 0) {
    return { error: "sessions must be a non-empty array" };
  }

  for (let i = 0; i < b.sessions.length; i++) {
    const s = b.sessions[i] as Record<string, unknown>;
    const prefix = `sessions[${i}]`;
    if (!s || typeof s !== "object") return { error: `${prefix} must be an object` };
    if (typeof s.date !== "string" || !DATE_RE.test(s.date)) {
      return { error: `${prefix}.date must be a YYYY-MM-DD string` };
    }
    if (typeof s.preferredSlot !== "string" || !SLOTS.includes(s.preferredSlot as TimeSlot)) {
      return { error: `${prefix}.preferredSlot must be one of ${SLOTS.join(", ")}` };
    }
    if (
      typeof s.planningType !== "string" ||
      !PLANNING_TYPES.includes(s.planningType as SessionPlanningType)
    ) {
      return { error: `${prefix}.planningType must be one of ${PLANNING_TYPES.join(", ")}` };
    }
    if (typeof s.durationMin !== "number" || !Number.isFinite(s.durationMin)) {
      return { error: `${prefix}.durationMin must be a number` };
    }
    if (typeof s.intensity !== "string" || !INTENSITIES.includes(s.intensity as SessionIntensity)) {
      return { error: `${prefix}.intensity must be one of ${INTENSITIES.join(", ")}` };
    }
    if (s.notes !== undefined && typeof s.notes !== "string") {
      return { error: `${prefix}.notes must be a string` };
    }
    if (s.workoutPlan !== undefined) {
      const wp = s.workoutPlan as Record<string, unknown>;
      if (!wp || typeof wp !== "object") return { error: `${prefix}.workoutPlan must be an object` };
      if (typeof wp.planType !== "string") return { error: `${prefix}.workoutPlan.planType must be a string` };
      if (typeof wp.goal !== "string") return { error: `${prefix}.workoutPlan.goal must be a string` };
      if (wp.target !== undefined && wp.target !== null && typeof wp.target !== "string") {
        return { error: `${prefix}.workoutPlan.target must be a string or null` };
      }
      if (!Array.isArray(wp.blocks)) return { error: `${prefix}.workoutPlan.blocks must be an array` };
      if (!Array.isArray(wp.generalRules)) {
        return { error: `${prefix}.workoutPlan.generalRules must be an array` };
      }
      if (wp.successCriteria !== undefined && wp.successCriteria !== null && !Array.isArray(wp.successCriteria)) {
        return { error: `${prefix}.workoutPlan.successCriteria must be an array or null` };
      }
      if (wp.fallbackCriteria !== undefined && wp.fallbackCriteria !== null && !Array.isArray(wp.fallbackCriteria)) {
        return { error: `${prefix}.workoutPlan.fallbackCriteria must be an array or null` };
      }
      if (wp.alternatives !== undefined && wp.alternatives !== null && !Array.isArray(wp.alternatives)) {
        return { error: `${prefix}.workoutPlan.alternatives must be an array or null` };
      }
      if (wp.summary !== undefined && wp.summary !== null && typeof wp.summary !== "string") {
        return { error: `${prefix}.workoutPlan.summary must be a string or null` };
      }
      if (typeof wp.rationale !== "string") {
        return { error: `${prefix}.workoutPlan.rationale must be a string` };
      }
      if (
        typeof wp.evaluationMode !== "string" ||
        !EVALUATION_MODES.includes(wp.evaluationMode as (typeof EVALUATION_MODES)[number])
      ) {
        return { error: `${prefix}.workoutPlan.evaluationMode must be one of ${EVALUATION_MODES.join(", ")}` };
      }
    }
  }

  if (b.fixedSessions !== undefined) {
    if (!Array.isArray(b.fixedSessions)) return { error: "fixedSessions must be an array" };
    for (let i = 0; i < b.fixedSessions.length; i++) {
      const f = b.fixedSessions[i] as Record<string, unknown>;
      const prefix = `fixedSessions[${i}]`;
      if (!f || typeof f !== "object") return { error: `${prefix} must be an object` };
      if (typeof f.date !== "string" || !DATE_RE.test(f.date)) {
        return { error: `${prefix}.date must be a YYYY-MM-DD string` };
      }
      if (typeof f.preferredSlot !== "string" || !SLOTS.includes(f.preferredSlot as TimeSlot)) {
        return { error: `${prefix}.preferredSlot must be one of ${SLOTS.join(", ")}` };
      }
      if (typeof f.durationMin !== "number" || !Number.isFinite(f.durationMin)) {
        return { error: `${prefix}.durationMin must be a number` };
      }
      if (f.intensity !== undefined && !INTENSITIES.includes(f.intensity as SessionIntensity)) {
        return { error: `${prefix}.intensity must be one of ${INTENSITIES.join(", ")}` };
      }
      if (typeof f.modality !== "string" || !MODALITIES.includes(f.modality as SessionModality)) {
        return { error: `${prefix}.modality must be one of ${MODALITIES.join(", ")}` };
      }
      if (f.notes !== undefined && typeof f.notes !== "string") {
        return { error: `${prefix}.notes must be a string` };
      }
    }
  }

  return { value: body as unknown as WeeklyPlanImport };
}

export async function POST(request: NextRequest) {
  const userId = await getSessionUserIdFromRequest(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const validated = validateBody(body);
  if ("error" in validated) return badRequest(validated.error);
  const input = validated.value;

  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.trainingPlan.updateMany({
        where: { userId, status: "active" },
        data: { status: "archived" },
      });

      const plan = await tx.trainingPlan.create({
        data: {
          userId,
          startsAt: new Date(input.weekStart),
          endsAt: new Date(input.weekEnd),
          status: "active",
          blockLabel: input.blockLabel ?? null,
          blockPhase: input.blockPhase ?? null,
          focusSummary: input.focusSummary ?? null,
        },
      });

      let sessionsCreated = 0;
      for (const s of input.sessions) {
        const session = await tx.trainingSession.create({
          data: {
            planId: plan.id,
            userId,
            scheduledDate: new Date(s.date),
            preferredSlot: s.preferredSlot,
            planningType: s.planningType,
            durationMin: s.durationMin,
            intensity: s.intensity,
            notes: s.notes ?? null,
          },
        });
        sessionsCreated++;

        if (s.workoutPlan) {
          const wp = s.workoutPlan;
          await tx.sessionWorkoutPlan.create({
            data: {
              sessionId: session.id,
              userId,
              planType: wp.planType,
              goal: wp.goal,
              target: wp.target ?? null,
              blocks: wp.blocks as unknown as Prisma.InputJsonValue,
              rules: {
                general: wp.generalRules,
                successCriteria: wp.successCriteria ?? null,
                fallbackCriteria: wp.fallbackCriteria ?? null,
              } as Prisma.InputJsonValue,
              alternatives: (wp.alternatives ?? null) as unknown as Prisma.InputJsonValue,
              summary: wp.summary ?? null,
              rationale: wp.rationale,
              evaluationMode: wp.evaluationMode,
            },
          });
        }
      }

      let fixedSessionsCreated = 0;
      for (const f of input.fixedSessions ?? []) {
        await tx.plannedFixedSession.create({
          data: {
            userId,
            scheduledDate: new Date(f.date),
            preferredSlot: f.preferredSlot,
            durationMin: f.durationMin,
            intensity: f.intensity ?? "moderate",
            modality: f.modality,
            notes: f.notes ?? null,
          },
        });
        fixedSessionsCreated++;
      }

      return { planId: plan.id, sessionsCreated, fixedSessionsCreated };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
