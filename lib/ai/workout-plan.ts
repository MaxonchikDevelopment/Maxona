import Anthropic from "@anthropic-ai/sdk";
import { buildHrZones } from "@/lib/training/zones";
import type { TrainingProfileInput } from "@/lib/training/zones";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// One Hybrid Circuit round always has 8 stations. "8 stations" ≠ "8 rounds".
const STATION_COUNT = 8;

export type WorkoutIntent =
  | "recovery_run"
  | "aerobic_base"
  | "tempo_run"
  | "marathon_pace"
  | "long_run"
  | "recovery_ride"
  | "aerobic_ride"
  | "technique_swim"
  | "endurance_swim"
  | "hybrid_engine"
  | "hybrid_race_prep"
  | "hybrid_strength"
  | "hybrid_technique"
  | "other";

export type WorkoutBlock = {
  label: string;
  durationMin: number;
  description: string;
  intensity: string;
  zone?: string | null;
  cue?: string | null;
  successCriteria?: string | null;
  stationCues?: string[] | null;
  equipment?: string[] | null;
  modification?: string | null;
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

export function deriveWorkoutIntent(
  notes: string | null,
  intensity: string,
  planType: string
): WorkoutIntent {
  const lower = (notes ?? "").toLowerCase();

  if (planType === "running") {
    if (lower.includes("long")) return "long_run";
    if (lower.includes("tempo") || lower.includes("threshold")) return "tempo_run";
    if (lower.includes("marathon")) return "marathon_pace";
    if (intensity === "easy" || lower.includes("easy") || lower.includes("recovery")) return "recovery_run";
    return "aerobic_base";
  }

  if (planType === "cycling") {
    if (intensity === "easy" || lower.includes("recovery") || lower.includes("easy")) return "recovery_ride";
    return "aerobic_ride";
  }

  if (planType === "swimming") {
    if (lower.includes("technique") || lower.includes("drill") || intensity === "easy") return "technique_swim";
    return "endurance_swim";
  }

  if (planType.startsWith("hybrid")) {
    if (lower.includes("technique") || lower.includes("drill")) return "hybrid_technique";
    if (lower.includes("strength") || lower.includes("heavy")) return "hybrid_strength";
    if (intensity === "hard") return "hybrid_race_prep";
    return "hybrid_engine";
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

const STATION_CUES_DEFAULT: string[] = [
  "Ski/row: smooth rhythm, avoid sprinting early, breathe on the drive",
  "Heavy push: controlled power, full hip extension, no jerky resets",
  "Heavy pull: steady tension, stable posture, drive through legs",
  "Burpee broad jumps: steady breathing, don't redline in round 1, consistent distance",
  "Row / bike erg: rhythmic cadence, focus on split not speed",
  "Farmer carry: tall posture, short steps, don't let shoulders drop",
  "Weighted lunges: stable knee tracking over toe, torso upright",
  "Wall balls / air squats: consistent depth, breathe on the way up",
];

function buildFallback(params: GenerateWorkoutPlanParams, planType: string): WorkoutPlanOutput {
  const dur = params.session.durationMin;
  const intensity = params.session.intensity;
  const notes = params.session.notes ?? "";
  const intent = deriveWorkoutIntent(notes, intensity, planType);

  if (planType === "running") {
    if (intent === "long_run") {
      const warmup = Math.min(10, Math.floor(dur * 0.12));
      const cooldown = 5;
      const main = dur - warmup - cooldown;
      return {
        planType,
        goal: "Progressive long run — first half conversational Z2, allow Z3 drift in second half if legs feel good",
        target: null,
        blocks: [
          { label: "Warm-up", durationMin: warmup, description: "Very easy walk/jog, no rushing — don't force the pace", intensity: "easy", zone: "Z1", cue: "Start slower than you think you need to" },
          { label: "Main run", durationMin: main, description: "First half at easy Z2 conversational; second half can drift toward upper Z2 naturally — no forcing", intensity: "moderate", zone: "Z2", successCriteria: "Able to speak in full sentences for the first half", modification: "If pace feels heavy, stay Z1–Z2 the whole way — no Z3 today" },
          { label: "Cool-down", durationMin: cooldown, description: "Easy walk, shake out legs", intensity: "easy", zone: "Z1" },
        ],
        rules: [
          "If HR climbs into Z4 before the halfway mark, slow to Z2 immediately.",
          "Carry water for sessions over 75 minutes.",
          "If legs feel heavy after 20min, reduce pace — don't push through.",
        ],
        alternatives: ["If route is hilly, reduce pace by 30–45s/km vs flat equivalent."],
        summary: `${dur}min long run — progressive Z2`,
      };
    }

    if (intent === "tempo_run") {
      const warmup = Math.min(12, Math.floor(dur * 0.2));
      const cooldown = Math.min(8, Math.floor(dur * 0.12));
      const main = dur - warmup - cooldown;
      return {
        planType,
        goal: "Tempo run — sustained Z3 effort, building lactate threshold at controlled pace",
        target: null,
        blocks: [
          { label: "Warm-up", durationMin: warmup, description: "Easy jog building gradually + 4×20s relaxed strides in final 2min", intensity: "easy", zone: "Z1–Z2", cue: "Strides should feel smooth, not fast" },
          { label: "Tempo", durationMin: main, description: "Controlled Z3 effort — can sustain short phrases, not full sentences; not threshold unless notes specify", intensity: "hard", zone: "Z3", cue: "Comfortably hard — mouth breathing but controlled", successCriteria: "Maintaining pace without HR climbing into Z4" },
          { label: "Cool-down", durationMin: cooldown, description: "Easy jog descending to walk, shake it out", intensity: "easy", zone: "Z1" },
        ],
        rules: [
          "If HR climbs into Z4 in the first 5min, drop pace to upper Z2 and settle in.",
          "If legs feel dead after warm-up, convert to aerobic base run — no penalty.",
        ],
        alternatives: null,
        summary: `${dur}min tempo — Z3 sustained`,
      };
    }

    if (intent === "marathon_pace") {
      const warmup = Math.min(10, Math.floor(dur * 0.15));
      const cooldown = Math.min(8, Math.floor(dur * 0.12));
      const main = dur - warmup - cooldown;
      return {
        planType,
        goal: "Marathon pace run — controlled Z3, disciplined not heroic",
        target: null,
        blocks: [
          { label: "Warm-up", durationMin: warmup, description: "Easy jog, build gradually", intensity: "easy", zone: "Z1–Z2" },
          { label: "Marathon pace", durationMin: main, description: "Controlled Z3 — race pace, not threshold; maintain form over speed", intensity: "moderate", zone: "Z3", cue: "If it feels too easy, it's probably right", successCriteria: "HR stays in Z3 without drifting toward Z4" },
          { label: "Cool-down", durationMin: cooldown, description: "Gradual slow to easy walk", intensity: "easy", zone: "Z1" },
        ],
        rules: [
          "If HR exceeds upper Z3 for 3+ minutes, slow down.",
          "Don't chase pace targets — use HR and feel as primary guide.",
        ],
        alternatives: null,
        summary: `${dur}min marathon pace run`,
      };
    }

    // recovery_run or aerobic_base
    const warmup = Math.min(8, Math.floor(dur * 0.12));
    const cooldown = Math.min(8, Math.floor(dur * 0.12));
    const main = dur - warmup - cooldown;
    const isRecovery = intent === "recovery_run";
    return {
      planType,
      goal: isRecovery
        ? "Recovery run — flush the legs at easy Z1–Z2, no HR spikes"
        : "Aerobic base run — build Z2 engine at conversational effort",
      target: null,
      blocks: [
        { label: "Warm-up", durationMin: warmup, description: "Easy walk into light jog", intensity: "easy", zone: "Z1" },
        { label: "Main run", durationMin: main, description: "Steady conversational effort — able to speak full sentences throughout", intensity: "easy", zone: isRecovery ? "Z1–Z2" : "Z2", cue: "If you're breathing hard, you're going too fast" },
        { label: "Cool-down", durationMin: cooldown, description: "Easy walk, relax", intensity: "easy", zone: "Z1" },
      ],
      rules: [
        "If HR exceeds Z2 upper, slow down or walk until it recovers.",
        "If legs feel heavy, that's normal on a recovery run — keep pace easy.",
      ],
      alternatives: null,
      summary: `${dur}min ${isRecovery ? "recovery" : "aerobic base"} run`,
    };
  }

  if (planType === "cycling") {
    const warmup = Math.min(10, Math.floor(dur * 0.15));
    const cooldown = Math.min(8, Math.floor(dur * 0.12));
    const main = dur - warmup - cooldown;
    const isRecovery = intensity === "easy" || intent === "recovery_ride";
    return {
      planType,
      goal: isRecovery
        ? "Recovery ride — easy Z1–Z2 spin, legs flush, no intensity"
        : "Aerobic base ride — sustained Z2 effort, cadence and consistency",
      target: null,
      blocks: [
        { label: "Warm-up", durationMin: warmup, description: "Easy spin, build cadence gradually", intensity: "easy", zone: "Z1" },
        { label: "Main ride", durationMin: main, description: isRecovery ? "Easy Z1–Z2 spin, cadence 85–95rpm — legs should feel like flushing, not working" : "Steady Z2, cadence 85–90rpm, avoid drifting into Z3", intensity: isRecovery ? "easy" : "moderate", zone: isRecovery ? "Z1–Z2" : "Z2", cue: isRecovery ? "Lighter than you think is necessary" : "Breathe through the nose if possible" },
        { label: "Cool-down", durationMin: cooldown, description: "Easy spin, very light resistance", intensity: "easy", zone: "Z1" },
      ],
      rules: [
        "Do not chase speed — use cadence and HR as your guide.",
        "If HR drifts into Z3 on flat road, shift to easier gear.",
      ],
      alternatives: null,
      summary: `${dur}min ${isRecovery ? "recovery" : "aerobic"} ride`,
    };
  }

  if (planType === "swimming") {
    const warmup = Math.min(10, Math.floor(dur * 0.18));
    const technique = Math.min(12, Math.floor(dur * 0.2));
    const cooldown = Math.min(5, Math.floor(dur * 0.1));
    const main = Math.max(5, dur - warmup - technique - cooldown);
    return {
      planType,
      goal: "Technique-focused swim — build efficient stroke at easy effort",
      target: null,
      blocks: [
        { label: "Warm-up", durationMin: warmup, description: "200–400m easy freestyle, settle breathing", intensity: "easy" },
        { label: "Technique drills", durationMin: technique, description: "2–3 drill sets: catch-up drill, fingertip drag, side kick — focus on reach and rotation", intensity: "easy", cue: "Long strokes, not fast strokes" },
        { label: "Main set", durationMin: main, description: "Steady laps at moderate effort with 15–20s rest per 100m", intensity: params.session.intensity },
        { label: "Cool-down", durationMin: cooldown, description: "100m easy backstroke, shake out arms", intensity: "easy" },
      ],
      rules: [
        "If stroke starts breaking down, pause and drill for 2 laps.",
        "Rest more between sets if breathing is not recovering.",
      ],
      alternatives: null,
      summary: `${dur}min swim — technique + main set`,
    };
  }

  if (planType.startsWith("hybrid")) {
    const { rounds, workSec, restSec } = normalizeHybridProfile(params.hybridProfile);
    const circuitMin = Math.round((rounds * STATION_COUNT * (workSec + restSec)) / 60);
    const baseWarmup = 10;
    const baseCooldown = 10;
    const afterCircuit = dur - baseWarmup - circuitMin - baseCooldown;
    const intensityRpe = intensity === "hard" ? "7–8" : intensity === "easy" ? "3–4" : "5–6";

    const blocks: WorkoutBlock[] = [];

    if (afterCircuit >= 10) {
      const techniqueMin = intent === "hybrid_technique" ? Math.min(15, afterCircuit - 5) : 10;
      const weaknessMin = afterCircuit - techniqueMin;
      blocks.push({
        label: "Warm-up",
        durationMin: baseWarmup,
        description: "Easy cardio (5min bike/row) + dynamic mobility: leg swings, hip circles, 3×10 air squats",
        intensity: "easy",
        cue: "Raise core temperature before loading the stations",
      });
      blocks.push({
        label: "Technique primer",
        durationMin: techniqueMin,
        description: "Practise 2 weaker stations at light load — focus on breathing rhythm and stable posture",
        intensity: "easy",
        cue: intent === "hybrid_technique" ? "Quality of movement over speed at every rep" : "Set the movement pattern before intensity rises",
      });
      blocks.push({
        label: "Main circuit",
        durationMin: circuitMin,
        description: `${rounds} rounds × ${STATION_COUNT} stations — ${workSec}s work / ${restSec}s transition · RPE ${intensityRpe}`,
        intensity: params.session.intensity,
        stationCues: STATION_CUES_DEFAULT,
        successCriteria: intent === "hybrid_race_prep"
          ? `Form holds through all ${rounds} rounds at race effort`
          : `Breathing stays controlled across all ${rounds} rounds`,
      });
      if (weaknessMin > 0) {
        blocks.push({
          label: "Weakness block",
          durationMin: weaknessMin,
          description: "Extra sets on 1–2 weakest stations, or steady ski/row at RPE 5 as aerobic flush",
          intensity: "moderate",
        });
      }
      blocks.push({
        label: "Cool-down",
        durationMin: baseCooldown,
        description: "Easy walk + stretch: hip flexors, lats, thoracic rotation",
        intensity: "easy",
      });
    } else if (afterCircuit >= 0) {
      const bonusPerEnd = Math.floor(afterCircuit / 2);
      blocks.push({
        label: "Warm-up",
        durationMin: baseWarmup + bonusPerEnd,
        description: "Easy cardio + dynamic mobility",
        intensity: "easy",
      });
      blocks.push({
        label: "Main circuit",
        durationMin: circuitMin,
        description: `${rounds} rounds × ${STATION_COUNT} stations — ${workSec}s work / ${restSec}s transition · RPE ${intensityRpe}`,
        intensity: params.session.intensity,
        stationCues: STATION_CUES_DEFAULT,
      });
      blocks.push({
        label: "Cool-down",
        durationMin: baseCooldown + (afterCircuit - bonusPerEnd),
        description: "Easy walk + full-body stretch",
        intensity: "easy",
      });
    } else {
      const mainMin = Math.max(5, dur - baseWarmup - baseCooldown);
      blocks.push({ label: "Warm-up", durationMin: baseWarmup, description: "Easy cardio + dynamic mobility", intensity: "easy" });
      blocks.push({
        label: "Circuit",
        durationMin: mainMin,
        description: `${rounds} rounds × ${STATION_COUNT} stations — ${workSec}s work / ${restSec}s transition (adjust rounds to fit time)`,
        intensity: params.session.intensity,
        stationCues: STATION_CUES_DEFAULT,
      });
      blocks.push({ label: "Cool-down", durationMin: baseCooldown, description: "Easy walk + stretch", intensity: "easy" });
    }

    return {
      planType,
      goal: intensity === "hard"
        ? `Race-pace station practice: sustain controlled output across all ${rounds} rounds`
        : `Controlled Hybrid Circuit endurance: steady effort and technique throughout ${rounds} rounds`,
      target: `${rounds} rounds × ${STATION_COUNT} stations · ${workSec}s work / ${restSec}s transition · RPE ${intensityRpe}`,
      blocks,
      rules: [
        `If breathing exceeds control for 2+ stations, reduce to ${Math.max(40, workSec - 10)}s work and ${restSec + 10}s transition.`,
        "If form breaks on push/pull or lunges, reduce load immediately — stop before technique fails.",
        intensity !== "hard"
          ? "If fatigue is high after round 1, drop to 2 rounds and extend cool-down."
          : "Between rounds, take 60s active rest (easy row/ski) if HR hasn't recovered.",
        "If equipment is unavailable: ski erg → row or bike; sled push → heavy farmer carry.",
      ],
      alternatives: null,
      summary: `${rounds}-round Hybrid Circuit · ${workSec}s/${restSec}s · approx ${circuitMin}min circuit`,
    };
  }

  const warmup = Math.min(10, Math.floor(dur * 0.15));
  const cooldown = Math.min(10, Math.floor(dur * 0.15));
  const main = dur - warmup - cooldown;
  return {
    planType,
    goal: `${dur}min ${planType} session — sustain ${intensity} effort with consistent pacing`,
    target: null,
    blocks: [
      { label: "Warm-up", durationMin: warmup, description: "Gradual effort increase", intensity: "easy" },
      { label: "Main", durationMin: main, description: "Maintain target effort", intensity: params.session.intensity },
      { label: "Cool-down", durationMin: cooldown, description: "Easy recovery", intensity: "easy" },
    ],
    rules: ["Adjust effort based on feel.", "Stop if pain occurs."],
    alternatives: null,
    summary: `${dur}min session at ${intensity} effort`,
  };
}

const SUBMIT_PLAN_TOOL = {
  name: "submit_workout_plan",
  description: "Submit the generated per-session workout plan",
  input_schema: {
    type: "object" as const,
    properties: {
      planType: { type: "string" },
      goal: {
        type: "string",
        description: "One sentence: specific session objective — reference modality, effort level, and purpose. NEVER 'Build work capacity', 'Improve fitness', or 'Complete the session'.",
      },
      target: {
        type: "string",
        description: "Optional measurable target (e.g. '10 km at Z2', '3 rounds × 8 stations · 60s work / 20s transition · RPE 5–6')",
      },
      blocks: {
        type: "array",
        description: "3–5 workout blocks in order",
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: "Warm-up / Technique primer / Main circuit / Weakness block / Cool-down / etc." },
            durationMin: { type: "number" },
            description: { type: "string", description: "≤ 2 sentences, actionable" },
            intensity: { type: "string", enum: ["easy", "moderate", "hard"] },
            zone: { type: "string", description: "HR zone (e.g. Z1–Z2, 140–155 bpm) — omit if no HR profile" },
            cue: { type: "string", description: "One key coaching cue for this block (≤ 15 words)" },
            successCriteria: { type: "string", description: "How to know this block went well (≤ 15 words)" },
            stationCues: {
              type: "array",
              items: { type: "string" },
              description: "Per-station coaching cues — Hybrid Circuit main block ONLY. Exactly 8 entries, one per station in order.",
            },
            modification: { type: "string", description: "Simpler version if conditions degrade (≤ 15 words)" },
          },
          required: ["label", "durationMin", "description", "intensity"],
        },
      },
      rules: {
        type: "array",
        description: "2–4 concrete if/then adjustment rules (≤ 25 words each)",
        items: { type: "string" },
      },
      alternatives: {
        type: "array",
        description: "1–2 alternatives if conditions change (weather, fatigue, equipment). Omit if none needed.",
        items: { type: "string" },
      },
      summary: { type: "string", description: "≤ 15 words: one-line plan summary" },
    },
    required: ["planType", "goal", "blocks", "rules"],
  },
} as const;

function buildSystemPrompt(): string {
  return `You are a precision sports coach generating a compact, actionable per-session workout plan.

CORE RULES:
- Block durations MUST sum to exactly the session durationMin — no exceptions.
- If HR zones are in zoneContext, reference them. Otherwise use RPE or "conversational effort".
- Rules must be concrete if/then statements — no vague advice.
- Do NOT mention HYROX as a product name. Use "Hybrid Circuit" or "station circuit".
- Keep language concise — this displays on mobile.
- goal field must be specific: reference modality, effort level, and purpose. REJECT generic goals.

BLOCK FIELDS TO USE:
- cue: one key coaching cue for the block (especially main block) — ≤15 words
- successCriteria: for the main block — how to know it went well — ≤15 words
- stationCues[]: 8 entries — Hybrid Circuit main circuit block ONLY
- modification: simpler option if conditions are worse than expected

INTENT-SPECIFIC INSTRUCTIONS (use the workoutIntent field):

--- recovery_run ---
- Warm-up 5–8m easy → Main Z1–Z2 conversational → Cool-down 5m
- No strides, no tempo language
- Goal: "Flush the legs at easy Z1–Z2 — conversational pace throughout, no HR spikes"

--- aerobic_base ---
- Warm-up → Main Z2 sustained → Cool-down
- Optional 4×20s relaxed strides only if feelScore 5–6 in readiness
- Goal: reference "Z2 aerobic base building"

--- tempo_run ---
- Warm-up: 10m easy jog + 4×20s strides
- Main: Z3 sustained, RPE 6–7 — comfortably hard, mouth breathing but controlled
- Cool-down: 5–8m easy
- Do not use exact pace unless session notes mention a specific pace target
- Goal: reference "Z3" and "controlled tempo"

--- marathon_pace ---
- Warm-up → MP block (controlled Z3, NOT threshold) → Cool-down
- Cue on main block: "race pace, not threshold — disciplined"
- Goal: reference "marathon pace" and "controlled Z3"

--- long_run ---
- Warm-up: 8–10m very easy
- Main: first half Z2 conversational, allow Z3 upper drift in second half if feeling good
- Include fueling reminder ONLY for 90min+: general, non-medical ("carry water")
- Cool-down: 5m easy walk
- Goal: reference "progressive" and "Z2 base"

--- recovery_ride ---
- Z1–Z2 throughout, cadence 85–95rpm, no speed or power targets
- Cue: "legs flushing, lighter than you think necessary"
- Goal: "recovery spin — flush the legs at Z1–Z2"

--- aerobic_ride ---
- Z2 sustained, cadence 85–90rpm — do not let it drift into Z3
- Goal: reference "Z2 aerobic base"

--- technique_swim ---
- Warm-up 200–400m → Drill sets (catch-up, fingertip drag, side kick) → Main set → Cool-down 100m easy
- Cue: "long strokes, not fast strokes"
- Goal: reference "efficient stroke" and "technique"

--- endurance_swim ---
- Warm-up → Main set with rest intervals per 100m → Cool-down
- Goal: reference "steady endurance" and distance/time context

--- hybrid_engine (moderate Hybrid Circuit) ---
- RPE target: 5–6 — controlled breathing, repeatable form, NOT race effort
- Block structure: Warm-up (10m) → Technique primer (8–10m) → Main circuit → Weakness block (time permitting) → Cool-down (8–10m)
- Main circuit block MUST include stationCues[] with exactly 8 entries (see station cues below)
- Main circuit durationMin MUST use the circuit time from hybridContext exactly
- If readiness/notes mention fatigue, illness, or allergy: lower RPE to 4–5, add "cut one round if needed" rule
- Goal: "Controlled station endurance — maintain repeatability and form across all {rounds} rounds"

--- hybrid_race_prep (hard Hybrid Circuit) ---
- RPE 7–8, race effort allowed
- Main circuit stationCues[] required — 8 entries
- Must include scaling rule: "If HR exceeds control after round 1, take 30s active rest before next round"
- If readiness/notes mention fatigue/illness/allergy: drop to RPE 6–7, add "cut one round if needed"
- Goal: "Race-pace station practice — sustain max repeatable output across all {rounds} rounds"

--- hybrid_strength / hybrid_technique ---
- RPE 4–5, form and movement quality emphasis
- Technique primer 12–15min for technique intent
- stationCues[] still required for main circuit block
- Goal: reference "technique" or "strength focus" specifically

STATION CUES for stationCues[] (Hybrid Circuit main block, use these verbatim or adapt):
1. Ski/row: smooth rhythm, avoid sprinting early, breathe on the drive
2. Heavy push: controlled power, full hip extension, no jerky resets
3. Heavy pull: steady tension, stable posture, drive through legs
4. Burpee broad jumps: steady breathing, don't redline in round 1, consistent distance
5. Row / bike erg: rhythmic cadence, focus on split not speed
6. Farmer carry: tall posture, short steps, don't let shoulders drop
7. Weighted lunges: stable knee tracking over toe, torso upright
8. Wall balls / air squats: consistent depth, breathe on the way up`;
}

export async function generateWorkoutPlan(params: GenerateWorkoutPlanParams): Promise<WorkoutPlanOutput> {
  const planType = derivePlanType(params.session.notes, params.hybridProfile);
  const workoutIntent = deriveWorkoutIntent(params.session.notes, params.session.intensity, planType);
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
    workoutIntent,
    zoneContext: zoneCtx,
    ...(hybridCtx && { hybridContext: hybridCtx }),
    ...(readinessStr && { readiness: readinessStr }),
    ...(recentStr && { recentSessions: recentStr }),
    ...(stravaStr && { lastExecution: stravaStr }),
  }, null, 2);

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1500,
      system: buildSystemPrompt(),
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

const GENERIC_GOAL_PHRASES = [
  "build work capacity",
  "improve fitness",
  "complete the session",
  "complete the planned",
];

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
      (b) =>
        b.description.toLowerCase().includes("station") ||
        b.description.toLowerCase().includes("round") ||
        (b.stationCues && b.stationCues.length >= 4)
    );
    if (!hasCircuit) return null;
  }

  if (isGenericGoal(plan.goal)) return null;

  return { ...plan, blocks: adjustedBlocks };
}
