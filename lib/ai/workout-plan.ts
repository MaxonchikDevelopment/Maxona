import Anthropic from "@anthropic-ai/sdk";
import { buildHrZones } from "@/lib/training/zones";
import type { TrainingProfileInput } from "@/lib/training/zones";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// One Hybrid Circuit round always has 8 stations. "8 stations" ≠ "8 rounds".
const STATION_COUNT = 8;

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

function normalizeHybridProfile(hybrid?: HybridProfileInput | null): {
  rounds: number;
  workSec: number;
  restSec: number;
} {
  const rawRounds = hybrid?.defaultRounds ?? 3;
  // Clamp suspicious values: if someone accidentally set rounds=8 (station count), reset to 3
  const rounds = rawRounds > 5 && STATION_COUNT >= 8 ? 3 : rawRounds;
  return {
    rounds,
    workSec: hybrid?.stationWorkSec ?? 60,
    restSec: hybrid?.stationRestSec ?? 20,
  };
}

function buildHybridContext(
  planType: string,
  hybrid?: HybridProfileInput | null,
  sessionDurationMin?: number
): string {
  if (!planType.startsWith("hybrid")) return "";
  const fmt = hybrid?.defaultFormat ?? "station_circuit";
  const { rounds, workSec, restSec } = normalizeHybridProfile(hybrid);
  const includesRun = hybrid?.includesRunningDefault ?? false;

  // Circuit time: rounds × 8 stations × (workSec + restSec) / 60
  const circuitMin = Math.round((rounds * STATION_COUNT * (workSec + restSec)) / 60);
  const remainingMin = sessionDurationMin ? sessionDurationMin - circuitMin : null;

  return `Hybrid Race format: ${fmt}
TERMINOLOGY (critical): rounds=${rounds} means full station list repeated ${rounds} times; stations=${STATION_COUNT} per round (NOT 8 rounds).
Target phrasing: "${rounds} rounds × ${STATION_COUNT} stations, ${workSec}s work / ${restSec}s transition"
Circuit time: ${rounds} × ${STATION_COUNT} × ${workSec + restSec}s ÷ 60 = approx ${circuitMin}min${remainingMin !== null ? `\nRemaining ~${remainingMin}min: use for warm-up, technique primer, weakness block, cool-down` : ""}
Running between stations: ${includesRun ? "yes" : "no"}
Station list (one round, ${STATION_COUNT} stations):
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
    const { rounds, workSec, restSec } = normalizeHybridProfile(params.hybridProfile);
    const circuitMin = Math.round((rounds * STATION_COUNT * (workSec + restSec)) / 60);
    const baseWarmup = 10;
    const baseCooldown = 10;
    const afterCircuit = dur - baseWarmup - circuitMin - baseCooldown;
    const intensityRpe = params.session.intensity === "hard" ? "7–8" : params.session.intensity === "easy" ? "3–4" : "5–6";

    const blocks: WorkoutBlock[] = [];

    if (afterCircuit >= 10) {
      const techniqueMin = 10;
      const weaknessMin = afterCircuit - techniqueMin;
      blocks.push({ label: "Warm-up", durationMin: baseWarmup, description: "Easy cardio (5min bike/row) + dynamic mobility: leg swings, hip circles, 3×10 air squats", intensity: "easy" });
      blocks.push({ label: "Technique primer", durationMin: techniqueMin, description: "Practise 2 weaker stations at light load — focus on breathing rhythm and stable posture before the main circuit", intensity: "easy" });
      blocks.push({ label: "Main circuit", durationMin: circuitMin, description: `${rounds} rounds × ${STATION_COUNT} stations — ${workSec}s work / ${restSec}s transition. Cues: Ski/row: steady rhythm. Push/pull: controlled power. Burpees: steady breathing. Carry: tall posture. Lunges: stable knees. Wall balls: consistent depth.`, intensity: params.session.intensity });
      if (weaknessMin > 0) {
        blocks.push({ label: "Weakness block", durationMin: weaknessMin, description: "Extra sets on 1–2 weakest stations, or steady ski/row at RPE 5 as aerobic flush", intensity: "moderate" });
      }
      blocks.push({ label: "Cool-down", durationMin: baseCooldown, description: "Easy walk + stretch: hip flexors, lats, thoracic rotation", intensity: "easy" });
    } else if (afterCircuit >= 0) {
      const bonusPerEnd = Math.floor(afterCircuit / 2);
      blocks.push({ label: "Warm-up", durationMin: baseWarmup + bonusPerEnd, description: "Easy cardio + dynamic mobility", intensity: "easy" });
      blocks.push({ label: "Main circuit", durationMin: circuitMin, description: `${rounds} rounds × ${STATION_COUNT} stations — ${workSec}s work / ${restSec}s transition`, intensity: params.session.intensity });
      blocks.push({ label: "Cool-down", durationMin: baseCooldown + (afterCircuit - bonusPerEnd), description: "Easy walk + full-body stretch", intensity: "easy" });
    } else {
      const mainMin = Math.max(5, dur - baseWarmup - baseCooldown);
      blocks.push({ label: "Warm-up", durationMin: baseWarmup, description: "Easy cardio + dynamic mobility", intensity: "easy" });
      blocks.push({ label: "Circuit", durationMin: mainMin, description: `${rounds} rounds × ${STATION_COUNT} stations — ${workSec}s work / ${restSec}s transition (adjust rounds to fit time)`, intensity: params.session.intensity });
      blocks.push({ label: "Cool-down", durationMin: baseCooldown, description: "Easy walk + stretch", intensity: "easy" });
    }

    return {
      planType,
      goal: params.session.intensity === "hard"
        ? `Race-pace station practice: sustain controlled output across all ${rounds} rounds`
        : `Controlled Hybrid Circuit endurance: steady effort and technique throughout ${rounds} rounds`,
      target: `${rounds} rounds × ${STATION_COUNT} stations · ${workSec}s work / ${restSec}s transition · RPE ${intensityRpe}`,
      blocks,
      rules: [
        `If breathing exceeds control for 2+ stations, reduce to ${Math.max(40, workSec - 10)}s work and ${restSec + 10}s transition.`,
        "If form breaks on push/pull or lunges, reduce load immediately — stop before technique fails.",
        params.session.intensity !== "hard"
          ? "If fatigue is high after round 1, drop to 2 rounds and extend cool-down."
          : "Between rounds, take 60s active rest (easy row/ski) if HR hasn't recovered.",
        "If equipment is unavailable: ski erg → row or bike; sled push → heavy farmer carry.",
      ],
      alternatives: null,
      summary: `${rounds}-round Hybrid Circuit · ${workSec}s/${restSec}s · approx ${circuitMin}min circuit`,
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
  const hybridCtx = buildHybridContext(planType, params.hybridProfile, params.session.durationMin);

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

General rules:
- Block durations must sum to exactly the session durationMin.
- If HR zones are provided, reference them. If not, use "conversational effort" or RPE descriptions.
- Rules must be concrete if/then statements — no vague advice.
- Keep everything compact — this displays in a mobile card.
- Do not mention HYROX as a product name. Use "Hybrid Circuit" or "station circuit" instead.

For Hybrid Circuit / station_circuit sessions:
- TERMINOLOGY: rounds = how many times all stations are repeated; stations = exercises in one round. Never call 8 stations "8 rounds".
- Use target format exactly: "X rounds × 8 stations · Ys work / Zs transition · RPE A–B"
- GOAL must be specific (e.g. "Controlled station endurance — maintain repeatability across all rounds"), NOT generic phrases like "build work capacity" or "complete the session".
- BLOCK STRUCTURE: Warm-up → Technique primer → Main circuit → Weakness block (if time allows) → Cool-down.
- The main circuit block MUST state rounds × stations × timing and include actionable station cues:
  Ski/row: smooth rhythm, avoid sprinting early; Push/pull: controlled power; Burpees: steady breathing, no redline R1; Carry: tall posture, short steps; Lunges: stable knee tracking; Wall balls/squats: consistent depth.
- Moderate sessions (easy/moderate intensity): RPE 5–6, focus on repeatability, NOT race effort.
- Hard sessions: allow RPE 7–8, include clear scaling rules.
- If readiness/notes mention fatigue, illness, or allergy: lower RPE target and add "cut one round if needed" rule.
- Use the circuit time from hybridContext for the main circuit block duration. Use remaining time for other blocks.

For running sessions:
- Easy/long: Z1–Z2 / conversational.
- Tempo: Z3 with controlled Z4 segments.

Do not invent equipment. Do not make medical claims about HR zones.`,
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

    const parsed: WorkoutPlanOutput = {
      planType: (raw.planType as string) || planType,
      goal: (raw.goal as string) || "",
      target: (raw.target as string | null) || null,
      blocks,
      rules,
      alternatives: alternatives && alternatives.length > 0 ? alternatives : null,
      summary: (raw.summary as string | null) || null,
    };

    const validated = validateAndAdjust(parsed, params, planType);
    return validated ?? buildFallback(params, planType);
  } catch (err) {
    console.error("[workout-plan] generateWorkoutPlan failed:", err);
    return buildFallback(params, planType);
  }
}

const GENERIC_GOAL_PHRASES = ["build work capacity", "improve fitness", "complete the session", "complete the planned"];

function isGenericGoal(goal: string): boolean {
  const lower = goal.toLowerCase();
  return GENERIC_GOAL_PHRASES.some((p) => lower.includes(p));
}

function adjustBlockDurations(blocks: WorkoutBlock[], targetDur: number): WorkoutBlock[] {
  const sum = blocks.reduce((s, b) => s + b.durationMin, 0);
  const diff = targetDur - sum;
  if (diff === 0 || blocks.length === 0) return blocks;
  // Adjust the largest non-first/last block; fall back to last block
  let adjustIdx = -1;
  for (let i = 1; i < blocks.length - 1; i++) {
    if (adjustIdx === -1 || blocks[i].durationMin > blocks[adjustIdx].durationMin) adjustIdx = i;
  }
  if (adjustIdx === -1) adjustIdx = blocks.length - 1;
  return blocks.map((b, i) =>
    i === adjustIdx ? { ...b, durationMin: Math.max(5, b.durationMin + diff) } : b
  );
}

function validateAndAdjust(
  plan: WorkoutPlanOutput,
  params: GenerateWorkoutPlanParams,
  planType: string
): WorkoutPlanOutput | null {
  if (!plan.blocks || plan.blocks.length < 2) return null;
  if (plan.rules.length < 2) return null;

  const blockSum = plan.blocks.reduce((s, b) => s + b.durationMin, 0);
  const targetDur = params.session.durationMin;

  if (Math.abs(blockSum - targetDur) > 5) return null;

  const adjustedBlocks = blockSum !== targetDur
    ? adjustBlockDurations(plan.blocks, targetDur)
    : plan.blocks;

  if (planType.startsWith("hybrid")) {
    const hasCircuit = adjustedBlocks.some(
      (b) => b.description.toLowerCase().includes("station") || b.description.toLowerCase().includes("round")
    );
    if (!hasCircuit) return null;
  }

  if (isGenericGoal(plan.goal)) return null;

  return { ...plan, blocks: adjustedBlocks };
}
