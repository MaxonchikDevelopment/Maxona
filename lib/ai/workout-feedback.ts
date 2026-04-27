import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export type AdherenceLabel =
  | "matched"
  | "slightly_short"
  | "clearly_short"
  | "longer_than_planned"
  | "different_sport"
  | "modified_due_fatigue"
  | "no_strava"
  | "unknown";

export type WorkoutFeedbackOutput = {
  adherenceLabel: AdherenceLabel;
  summary: string;
  bullets: string[];
  nextAdjustment: string | null;
};

export type GenerateWorkoutFeedbackParams = {
  session: {
    durationMin: number;
    intensity: string;
    notes: string | null;
  };
  workoutPlan?: {
    planType: string;
    goal: string;
    target: string | null;
    blocks: Array<{ label: string; durationMin: number; intensity: string }>;
    summary: string | null;
  } | null;
  checkIn?: {
    feelScore: number;
    notes: string | null;
  } | null;
  executionSummary?: {
    actualMovingMin: number;
    actualDistanceKm: number | null;
    paceStr: string | null;
    qualityLabel: string;
    avgHR: number | null;
    splitSession: boolean;
    hillsIndicator: boolean;
    actualSportTypes: string[];
  } | null;
};

const SUBMIT_FEEDBACK_TOOL = {
  name: "submit_workout_feedback",
  description: "Submit structured post-workout feedback comparing planned vs actual execution",
  input_schema: {
    type: "object" as const,
    properties: {
      adherenceLabel: {
        type: "string",
        enum: [
          "matched",
          "slightly_short",
          "clearly_short",
          "longer_than_planned",
          "different_sport",
          "modified_due_fatigue",
          "no_strava",
          "unknown",
        ],
        description: "How closely actual execution matched the plan",
      },
      summary: {
        type: "string",
        description: "1–2 sentence coach summary of session vs plan",
      },
      bullets: {
        type: "array",
        items: { type: "string" },
        description: "2–3 specific observations about execution quality, each ≤ 20 words",
      },
      nextAdjustment: {
        type: "string",
        description:
          "1 concrete suggestion for next session. Omit if session matched plan well.",
      },
    },
    required: ["adherenceLabel", "summary", "bullets"],
  },
} as const;

function buildDeterministicFeedback(
  params: GenerateWorkoutFeedbackParams
): WorkoutFeedbackOutput {
  const { checkIn, executionSummary, session } = params;

  if (!executionSummary) {
    const feelScore = checkIn?.feelScore ?? 0;
    const notes = checkIn?.notes ?? null;
    if (feelScore <= 2) {
      return {
        adherenceLabel: "no_strava",
        summary: `Feel score was low (${feelScore}/6) — session was likely difficult or cut short. No Strava data to verify.`,
        bullets: [
          `Feel score: ${feelScore}/6${notes ? ` — "${notes}"` : ""}`,
          "No Strava activity attached.",
        ],
        nextAdjustment: "Consider an easier recovery session.",
      };
    }
    return {
      adherenceLabel: "no_strava",
      summary: notes
        ? `No Strava data. Check-in notes: "${notes}".`
        : "No Strava data attached — cannot verify execution.",
      bullets: [
        `Feel score: ${feelScore}/6`,
        "Attach a Strava activity for detailed execution analysis.",
      ],
      nextAdjustment: null,
    };
  }

  const ql = executionSummary.qualityLabel;
  const adherenceMap: Record<string, AdherenceLabel> = {
    Matched: "matched",
    "Slightly short": "slightly_short",
    "Clearly short": "clearly_short",
    "Longer than planned": "longer_than_planned",
    Interrupted: "slightly_short",
    "Hilly variant": "matched",
  };
  const adherenceLabel: AdherenceLabel = adherenceMap[ql] ?? "unknown";

  const bullets: string[] = [];
  const actual = executionSummary.actualMovingMin;
  const planned = session.durationMin;
  const delta = actual - planned;
  bullets.push(
    delta === 0
      ? `Duration matched: ${actual} min`
      : `Duration: ${actual} min moving (planned ${planned} min, ${delta > 0 ? "+" : ""}${delta} min)`
  );
  if (executionSummary.actualDistanceKm) {
    bullets.push(
      `Distance: ${executionSummary.actualDistanceKm} km${executionSummary.paceStr ? ` at ${executionSummary.paceStr}` : ""}`
    );
  }
  if (executionSummary.avgHR) {
    bullets.push(`HR avg: ${executionSummary.avgHR} bpm`);
  }

  const summaryMap: Record<string, string> = {
    Matched: "Execution matched the plan.",
    "Slightly short": "Session was slightly shorter than planned.",
    "Clearly short": "Session was clearly shorter than planned.",
    "Longer than planned": "Session ran longer than planned — watch accumulated load.",
    Interrupted: "Session was split or interrupted.",
    "Hilly variant": "Matched planned duration with added elevation load.",
  };

  return {
    adherenceLabel,
    summary: summaryMap[ql] ?? `Execution: ${ql.toLowerCase()}.`,
    bullets: bullets.slice(0, 3),
    nextAdjustment:
      adherenceLabel === "clearly_short"
        ? "Review why the session was cut short; target full duration next time."
        : null,
  };
}

function detectDifferentSport(
  sessionNotes: string | null,
  actualSportTypes: string[]
): boolean {
  if (!sessionNotes || actualSportTypes.length === 0) return false;
  const lower = sessionNotes.toLowerCase();
  const plannedRun = lower.startsWith("running");
  const plannedCycle = lower.startsWith("cycling");
  const plannedSwim = lower.startsWith("swimming");

  const actualHasRun = actualSportTypes.some((s) => /run/i.test(s));
  const actualHasCycle = actualSportTypes.some((s) =>
    /ride|cycling|cycle|bike|ebike/i.test(s)
  );
  const actualHasSwim = actualSportTypes.some((s) => /swim/i.test(s));

  if (plannedRun && !actualHasRun) return true;
  if (plannedCycle && !actualHasCycle) return true;
  if (plannedSwim && !actualHasSwim) return true;
  return false;
}

export async function generateWorkoutFeedback(
  params: GenerateWorkoutFeedbackParams
): Promise<WorkoutFeedbackOutput> {
  const { session, workoutPlan, checkIn, executionSummary } = params;

  const isSportMismatch =
    executionSummary &&
    detectDifferentSport(session.notes, executionSummary.actualSportTypes);

  const plannedStr = workoutPlan
    ? `Planned: ${workoutPlan.goal}${workoutPlan.target ? ` · Target: ${workoutPlan.target}` : ""}${workoutPlan.summary ? ` · ${workoutPlan.summary}` : ""}`
    : `Planned: ${session.durationMin}min ${session.intensity} session${session.notes ? ` (${session.notes})` : ""}`;

  const planBlocksStr =
    workoutPlan?.blocks && workoutPlan.blocks.length > 0
      ? `Plan blocks: ${workoutPlan.blocks.map((b) => `${b.label} ${b.durationMin}m`).join(" → ")}`
      : null;

  const checkInStr = checkIn
    ? `Check-in: feel ${checkIn.feelScore}/6${checkIn.notes ? ` — "${checkIn.notes}"` : ""}`
    : "Check-in: none";

  let executionStr = "No Strava data attached.";
  if (executionSummary) {
    const parts: string[] = [
      `${executionSummary.actualMovingMin}min moving`,
      executionSummary.actualDistanceKm
        ? `${executionSummary.actualDistanceKm}km`
        : null,
      executionSummary.paceStr ?? null,
      executionSummary.avgHR ? `HR avg ${executionSummary.avgHR}` : null,
      executionSummary.splitSession ? "split session" : null,
      executionSummary.hillsIndicator ? "hilly" : null,
    ].filter(Boolean) as string[];

    const sportStr =
      executionSummary.actualSportTypes.length > 0
        ? executionSummary.actualSportTypes.join("+")
        : null;

    executionStr = `Actual: ${sportStr ? `${sportStr} · ` : ""}${parts.join(" · ")} · Quality label: ${executionSummary.qualityLabel}`;

    if (isSportMismatch) {
      executionStr += " · SPORT MISMATCH: planned sport differs from actual";
    }
  }

  const userPrompt = [plannedStr, planBlocksStr, executionStr, checkInStr]
    .filter(Boolean)
    .join("\n");

  const systemPrompt = `You are a concise sports coach writing a post-workout feedback comparison (planned vs actual).

Rules:
- Ground ONLY in the data provided — never invent block-by-block execution.
- If no Strava data: base feedback solely on feel score and check-in notes; use adherenceLabel "no_strava".
- If SPORT MISMATCH is flagged: use adherenceLabel "different_sport" and state clearly: "Planned [X] became [Y]; aerobic load counted, [X]-specific load did not."
- If actual duration is >20% over planned: use "longer_than_planned" and note load risk in nextAdjustment.
- If feelScore is 1–3 AND notes mention allergy/sickness/fatigue AND session was short: use "modified_due_fatigue"; treat this as intelligent adjustment, not failure.
- summary: 1–2 sentences, coach-like and specific.
- bullets: 2–3 items, each ≤ 20 words, specific data points (duration delta, pace, HR).
- nextAdjustment: only when session missed target or needs follow-up; omit if matched.
- No generic advice. No "listen to your body".`;

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      system: systemPrompt,
      tools: [SUBMIT_FEEDBACK_TOOL],
      tool_choice: { type: "tool", name: "submit_workout_feedback" },
      messages: [{ role: "user", content: userPrompt }],
    });

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      return buildDeterministicFeedback(params);
    }

    const raw = toolUse.input as Record<string, unknown>;
    const bullets = Array.isArray(raw.bullets) ? (raw.bullets as string[]) : [];

    return {
      adherenceLabel: (raw.adherenceLabel as AdherenceLabel) ?? "unknown",
      summary: (raw.summary as string) || "",
      bullets: bullets.slice(0, 4),
      nextAdjustment: (raw.nextAdjustment as string | null) ?? null,
    };
  } catch (err) {
    console.error("[workout-feedback] generateWorkoutFeedback failed:", err);
    return buildDeterministicFeedback(params);
  }
}
