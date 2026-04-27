import Anthropic from "@anthropic-ai/sdk";
import { buildHrZones } from "@/lib/training/zones";
import type { TrainingProfileInput } from "@/lib/training/zones";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export type WorkoutBlock = {
  label: string;
  durationMin: number;
  description: string;
  intensity: string;
  zone?: string | null;
};

export type WorkoutPlanOutput = {
  planType: string;
  goal: string;
  target: string | null;
  blocks: WorkoutBlock[];
  rules: string[];
  alternatives: string[] | null;
  summary: string | null;
};

export type HybridProfileInput = {
  defaultFormat?: string | null;
  includesRunningDefault?: boolean;
  stationWorkSec?: number;
  stationRestSec?: number;
  defaultRounds?: number;
  notes?: string | null;
};

export type GenerateWorkoutPlanParams = {
  session: {
    id: string;
    scheduledDate: string;
    durationMin: number;
    intensity: string;
    notes: string | null;
    preferredSlot: string;
  };
  trainingProfile?: TrainingProfileInput | null;
  hybridProfile?: HybridProfileInput | null;
  readinessContext?: {
    feelScore?: number;
    category?: string;
    notes?: string | null;
  } | null;
  recentSignals?: Array<{
    date: string;
    intensity: string;
    feelScore?: number;
    notes?: string | null;
  }>;
  stravaExecution?: {
    actualMovingMin?: number;
    actualDistanceKm?: number | null;
    avgHR?: number | null;
    maxHR?: number | null;
    qualityLabel?: string;
  } | null;
};

function derivePlanType(notes: string | null, hybridProfile?: HybridProfileInput | null): string {
  const lower = (notes ?? "").toLowerCase();
  if (lower.startsWith("running")) return "running";
  if (lower.startsWith("cycling")) return "cycling";
  if (lower.startsWith("swimming")) return "swimming";

  const isHybrid =
    lower.includes("hyrox") ||
    lower.includes("hybrid") ||
    lower.includes("station") ||
    lower.includes("circuit") ||
    lower.startsWith("strength");

  if (isHybrid) {
    const fmt = hybridProfile?.defaultFormat ?? "station_circuit";
    if (fmt === "race_simulation" || lower.includes("race sim")) return "hybrid_race_simulation";
    if (fmt === "run_station_intervals") return "hybrid_run_station";
    return "hybrid_station_circuit";
  }

  return "other";
}

function buildZoneContext(profile?: TrainingProfileInput | null): string {
  if (!profile) return "Use conversational effort / RPE since no HR profile is set.";
  const zones = buildHrZones(profile);
  if (!zones) return "Use conversational effort / RPE since HR data is incomplete.";
  return `HR zones (Karvonen):
Z1 recovery: ${zones.z1.min}–${zones.z1.max} bpm
Z2 easy aerobic: ${zones.z2.min}–${zones.z2.max} bpm
Z3 tempo: ${zones.z3.min}–${zones.z3.max} bpm
Z4 threshold: ${zones.z4.min}–${zones.z4.max} bpm
Z5 VO2max: ${zones.z5.min}–${zones.z5.max} bpm`;
}

function buildHybridContext(planType: string, hybrid?: HybridProfileInput | null): string {
  if (!planType.startsWith("hybrid")) return "";
  const fmt = hybrid?.defaultFormat ?? "station_circuit";
  const workSec = hybrid?.stationWorkSec ?? 60;
  const restSec = hybrid?.stationRestSec ?? 20;
  const rounds = hybrid?.defaultRounds ?? 3;
  const includesRun = hybrid?.includesRunningDefault ?? false;

  return `Hybrid Race format: ${fmt}
Station work: ${workSec}s · Rest: ${restSec}s · Rounds: ${rounds}
Running between stations: ${includesRun ? "yes" : "no"}
Default station list (use unless notes suggest otherwise):
1. Ski erg or row
2. Heavy push (sled substitute)
3. Heavy pull (sled substitute)
4. Burpee broad jumps
5. Row or bike erg
6. Farmer carry
7. Weighted lunges or sandbag lunges
8. Wall balls or air squats`;
}

function buildFallback(params: GenerateWorkoutPlanParams, planType: string): WorkoutPlanOutput {
  const dur = params.session.durationMin;
  const warmup = Math.min(10, Math.floor(dur * 0.15));
  const cooldown = Math.min(10, Math.floor(dur * 0.15));
  const main = dur - warmup - cooldown;

  if (planType === "running") {
    return {
      planType,
      goal: "Complete the planned run at the right effort",
      target: null,
      blocks: [
        { label: "Warm-up", durationMin: warmup, description: "Easy jog, gradually increasing pace", intensity: "easy", zone: "Z1" },
        { label: "Main", durationMin: main, description: "Steady conversational effort", intensity: params.session.intensity, zone: "Z2" },
        { label: "Cool-down", durationMin: cooldown, description: "Easy walk/jog", intensity: "easy", zone: "Z1" },
      ],
      rules: ["If breathing becomes labored, slow down.", "If legs feel heavy, reduce pace and extend warm-up."],
      alternatives: null,
      summary: `${dur}min run at ${params.session.intensity} effort`,
    };
  }

  if (planType.startsWith("hybrid")) {
    const rounds = params.hybridProfile?.defaultRounds ?? 3;
    return {
      planType,
      goal: "Complete the station circuit with good form",
      target: `${rounds} rounds`,
      blocks: [
        { label: "Warm-up", durationMin: warmup, description: "Light cardio and mobility", intensity: "easy" },
        { label: "Circuit", durationMin: main, description: `${rounds} rounds of 8 stations — ${params.hybridProfile?.stationWorkSec ?? 60}s work / ${params.hybridProfile?.stationRestSec ?? 20}s rest`, intensity: params.session.intensity },
        { label: "Cool-down", durationMin: cooldown, description: "Stretch and breathe", intensity: "easy" },
      ],
      rules: ["Rest between rounds if HR doesn't recover.", "Scale weight if form breaks down."],
      alternatives: null,
      summary: `${rounds}-round hybrid station circuit`,
    };
  }

  return {
    planType,
    goal: `Complete the ${dur}min session`,
    target: null,
    blocks: [
      { label: "Warm-up", durationMin: warmup, description: "Gradual effort increase", intensity: "easy" },
      { label: "Main", durationMin: main, description: "Maintain target effort", intensity: params.session.intensity },
      { label: "Cool-down", durationMin: cooldown, description: "Easy recovery", intensity: "easy" },
    ],
    rules: ["Adjust effort based on feel.", "Stop if pain occurs."],
    alternatives: null,
    summary: `${dur}min session at ${params.session.intensity} effort`,
  };
}

const SUBMIT_PLAN_TOOL = {
  name: "submit_workout_plan",
  description: "Submit the generated per-session workout plan",
  input_schema: {
    type: "object" as const,
    properties: {
      planType: { type: "string" },
      goal: { type: "string", description: "One sentence: what is this session trying to achieve?" },
      target: { type: "string", description: "Optional: a specific measurable target (e.g. '10 km at Z2', '3 rounds')" },
      blocks: {
        type: "array",
        description: "2–5 workout blocks in order",
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: "Warm-up / Main / Intervals / Cool-down / etc." },
            durationMin: { type: "number" },
            description: { type: "string", description: "≤ 2 sentences, actionable" },
            intensity: { type: "string", enum: ["easy", "moderate", "hard"] },
            zone: { type: "string", description: "e.g. Z1–Z2 or 140–155 bpm — omit if no HR profile" },
          },
          required: ["label", "durationMin", "description", "intensity"],
        },
      },
      rules: {
        type: "array",
        description: "2–4 if/then adjustment rules (≤ 20 words each)",
        items: { type: "string" },
      },
      alternatives: {
        type: "array",
        description: "1–2 alternatives if conditions change (weather, fatigue). Omit if none needed.",
        items: { type: "string" },
      },
      summary: { type: "string", description: "≤ 15 words: one-line plan summary" },
    },
    required: ["planType", "goal", "blocks", "rules"],
  },
} as const;

export async function generateWorkoutPlan(params: GenerateWorkoutPlanParams): Promise<WorkoutPlanOutput> {
  const planType = derivePlanType(params.session.notes, params.hybridProfile);
  const zoneCtx = buildZoneContext(params.trainingProfile);
  const hybridCtx = buildHybridContext(planType, params.hybridProfile);

  const recentStr = (params.recentSignals ?? []).slice(0, 4)
    .map((s) => `${s.date}: ${s.intensity}${s.notes ? ` · ${s.notes}` : ""}${s.feelScore != null ? ` (feel ${s.feelScore}/6)` : ""}`)
    .join("\n");

  const readinessStr = params.readinessContext
    ? `Readiness: feel ${params.readinessContext.feelScore}/6, category=${params.readinessContext.category}${params.readinessContext.notes ? `, notes="${params.readinessContext.notes}"` : ""}`
    : "";

  const stravaStr = params.stravaExecution
    ? `Last Strava execution: ${params.stravaExecution.actualMovingMin ?? "?"}min moving${params.stravaExecution.actualDistanceKm ? ` · ${params.stravaExecution.actualDistanceKm} km` : ""}${params.stravaExecution.avgHR ? ` · HR avg ${params.stravaExecution.avgHR}` : ""} — ${params.stravaExecution.qualityLabel ?? "unknown"}`
    : "";

  const userPrompt = JSON.stringify({
    session: {
      date: params.session.scheduledDate,
      slot: params.session.preferredSlot,
      durationMin: params.session.durationMin,
      intensity: params.session.intensity,
      notes: params.session.notes,
    },
    planType,
    zoneContext: zoneCtx,
    ...(hybridCtx && { hybridContext: hybridCtx }),
    ...(readinessStr && { readiness: readinessStr }),
    ...(recentStr && { recentSessions: recentStr }),
    ...(stravaStr && { lastExecution: stravaStr }),
  }, null, 2);

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: `You are a sports coach. Generate a compact, actionable per-session workout plan.

Rules:
- Total block durations must sum to exactly the session durationMin.
- If HR zones are provided, reference them. If not, use "conversational effort" or RPE descriptions.
- For hybrid/station-circuit: use the station list and timing from the context. Do not invent equipment.
- If session is labeled as race simulation in the notes, generate a race-prep format. Otherwise default to station_circuit.
- Rules must be concrete if/then statements. No vague advice.
- Keep everything compact — this displays in a mobile card.
- Do not mention HYROX as a product name in new content. Use "Hybrid Circuit" or "station circuit" instead.`,
      tools: [SUBMIT_PLAN_TOOL],
      tool_choice: { type: "tool", name: "submit_workout_plan" },
      messages: [{ role: "user", content: userPrompt }],
    });

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      return buildFallback(params, planType);
    }

    const raw = toolUse.input as Record<string, unknown>;

    const blocks = (Array.isArray(raw.blocks) ? raw.blocks : []) as WorkoutBlock[];
    const rules = (Array.isArray(raw.rules) ? raw.rules : []) as string[];
    const alternatives = Array.isArray(raw.alternatives) ? (raw.alternatives as string[]) : null;

    return {
      planType: (raw.planType as string) || planType,
      goal: (raw.goal as string) || "",
      target: (raw.target as string | null) || null,
      blocks,
      rules,
      alternatives: alternatives && alternatives.length > 0 ? alternatives : null,
      summary: (raw.summary as string | null) || null,
    };
  } catch (err) {
    console.error("[workout-plan] generateWorkoutPlan failed:", err);
    return buildFallback(params, planType);
  }
}
