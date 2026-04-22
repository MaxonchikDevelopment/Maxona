import Anthropic from "@anthropic-ai/sdk";
import type { AIAdapter, PlanningContext, PlanResult, PlannedSession } from "./adapter";

export class ClaudeAdapter implements AIAdapter {
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  async generatePlan(context: PlanningContext): Promise<PlanResult> {
    const response = await this.client.messages.create({
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      tools: [SUBMIT_PLAN_TOOL],
      tool_choice: { type: "tool", name: "submit_plan" },
      messages: [{ role: "user", content: buildUserPrompt(context) }],
    });

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      throw new Error("ClaudeAdapter: expected tool_use block in response");
    }

    const input = toolUse.input as SubmitPlanInput;

    return {
      focusSummary: input.focusSummary,
      changeExplanation: input.changeExplanation,
      sessions: input.sessions.map((s) => ({
        scheduledDate: new Date(s.scheduledDate),
        preferredSlot: s.preferredSlot as PlannedSession["preferredSlot"],
        planningType: s.planningType as PlannedSession["planningType"],
        durationMin: s.durationMin,
        intensity: s.intensity as PlannedSession["intensity"],
        notes: s.notes,
      })),
    };
  }
}

interface SubmitPlanInput {
  focusSummary: string;
  changeExplanation?: string;
  sessions: Array<{
    scheduledDate: string;
    preferredSlot: string;
    planningType: string;
    durationMin: number;
    intensity: string;
    notes?: string;
  }>;
}

const SYSTEM_PROMPT = `You are an adaptive sports training assistant for an endurance athlete targeting both a marathon and a HYROX competition.

## Your task
Generate a structured 7-day training plan using the submit_plan tool.

## Session density — CRITICAL
- Target 4–6 training sessions per week. This is an active, fit athlete with genuine training capacity.
- A week with only 2–3 sessions is almost always wrong — push for more.
- Rest days are intentional; do not leave days empty just to be conservative.

## Training modalities — REQUIRED
Use ONLY these four modalities. Do not invent others. The notes field is REQUIRED for every session.
- "HYROX group class" — the real weekly group session at the gym (functional fitness + running stations); 75–90 min; hard or moderate
- "running" — road/trail run; specify subtype: easy run | tempo run | long run | interval run | recovery run
- "cycling" — indoor or outdoor bike; 45–90 min; easy or moderate
- "swimming" — pool; 45–75 min; easy or moderate

Format notes as "<modality>: <subtype and brief detail>".
Examples: "running: long run 18 km easy pace", "HYROX group class: full race simulation", "cycling: 60 min easy aerobic spin", "swimming: 2 km steady"

## Typical session durations
- running easy/recovery: 45–60 min
- running tempo/interval: 60–75 min
- running long run: 90–150 min (weekend morning — cornerstone session each week)
- HYROX group class: 75–90 min
- cycling: 45–75 min
- swimming: 45–60 min

## Weekly structure (adapt to availability and constraints)
- 1–2 HYROX group classes per week (the real group session)
- 1 long run — Saturday or Sunday morning, easy intensity, 90–150 min
- 1–2 additional runs (easy/tempo/interval) for marathon base
- Cycling or swimming optional for active recovery
- Wednesday = office day — rest or short easy session only
- Hard sessions (tempo, interval, HYROX group class at hard intensity) never on consecutive days

## Multi-goal balance — REQUIRED
Both marathon AND HYROX must be addressed every week.
A plan with only running or only HYROX group class is wrong.

## Intensity mapping
- easy: RPE 4–5, conversational pace (long runs, recovery)
- moderate: RPE 6–7 (tempo, threshold, cycling/swimming at effort)
- hard: RPE 8–9 (intervals, HYROX group class at race pace)

## Availability windows
timeStartMin and timeEndMin are minutes since midnight in the user's local timezone (e.g. 360 = 06:00, 1080 = 18:00).
Only schedule sessions within listed windows. Each session must fit entirely inside a window.

## Hard constraints
- Skip any day covered by a scheduleEvent
- Minimum 48 h between "hard" sessions
- Each single session must be shorter than maxContinuousTrainingMinutes

## planningType values
- generated: fully flexible (use for most sessions)
- preferred: preserve if possible
- fixed: cannot be moved or removed

## Date context
"today" in the prompt is the user's current local date. Only schedule sessions on today or future dates — never in the past.
If "thisWeekAlreadyDone" is present, those sessions are already completed. Do NOT schedule anything on those dates. Subtract their minutes from your total volume budget.

## Check-in signals — apply ALWAYS, not only on replan
Read thisWeekCheckIns and previousWeek.lowFeelWarnings BEFORE planning any sessions.

thisWeekCheckIns are from the CURRENT week — they are the highest-priority signal.

Rules for thisWeekCheckIns:
1. Any entry with feelScore ≤ 2 AND notes mentioning injury / pain / hurt / sore / leg / knee / ankle / back:
   - MANDATORY: no hard sessions for the NEXT 2 days after that date
   - Convert the immediately following session to easy only or rest
   - Do NOT schedule the affected movement pattern (running if leg/knee, etc.)
2. Any entry with feelScore ≤ 2 (no injury keyword): make the immediately next session easy only
3. Two or more entries with feelScore ≤ 2: reduce remaining weekly volume by 15–20%, no hard sessions for the rest of the week
4. All entries feelScore ≥ 4: you may maintain or add a modest +5–10% volume — ONE good session does not justify a large load spike

previousWeek (recentCheckIns) signals apply the same rules at lower weight — current-week signals always override.

## changeExplanation
When replanReason is present: REQUIRED. Write 1–3 specific sentences describing exactly what changed versus the previous plan and why — reference specific check-in data or constraints if applicable.`;

const SUBMIT_PLAN_TOOL = {
  name: "submit_plan",
  description: "Submit the generated weekly training plan",
  input_schema: {
    type: "object",
    properties: {
      focusSummary: {
        type: "string",
        description:
          "One sentence describing the week's training theme, e.g. 'Marathon base-building week with HYROX strength on Tuesday and Thursday.'",
      },
      changeExplanation: {
        type: "string",
        description:
          "Required when replanReason is present. 1–3 sentences on what specifically changed versus the previous plan and why. Omit for initial plan generation.",
      },
      sessions: {
        type: "array",
        description: "4–6 sessions covering the 7-day week",
        items: {
          type: "object",
          properties: {
            scheduledDate: { type: "string", description: "YYYY-MM-DD" },
            preferredSlot: {
              type: "string",
              enum: ["morning", "daytime", "afternoon", "evening"],
            },
            planningType: {
              type: "string",
              enum: ["fixed", "preferred", "generated"],
            },
            durationMin: {
              type: "number",
              description: "Session duration in minutes (45–150 typical range)",
            },
            intensity: {
              type: "string",
              enum: ["easy", "moderate", "hard"],
            },
            notes: {
              type: "string",
              description:
                "Modality and optional subtype from the allowed list. E.g.: 'running: long run', 'HYROX group class', 'cycling: easy aerobic', 'swimming'.",
            },
          },
          required: [
            "scheduledDate",
            "preferredSlot",
            "planningType",
            "durationMin",
            "intensity",
            "notes",
          ],
        },
      },
    },
    required: ["focusSummary", "sessions"],
  },
} as const;

function buildUserPrompt(context: PlanningContext): string {
  const isReplan = !!context.replanReason;

  const availabilityByDay = formatAvailability(context.availabilityWindows);

  const previousSessionsSummary = context.previousSessions.map((s) => {
    const ci = context.recentCheckIns.find((c) => c.sessionId === s.id);
    return {
      date: toDateStr(s.scheduledDate),
      durationMin: s.durationMin,
      intensity: s.intensity,
      type: s.notes ?? "unspecified",
      checkIn: ci ? { feelScore: ci.feelScore, notes: ci.notes } : null,
    };
  });

  const prevLowFeelWarnings = context.recentCheckIns
    .filter((c) => c.feelScore <= 2)
    .map(
      (c) =>
        `PREV-WEEK WARNING: ${c.sessionDate} (${c.sessionIntensity}) feelScore=${c.feelScore}${c.notes ? ` — "${c.notes}"` : ""}`
    );

  const thisWeekLowFeelWarnings = context.thisWeekCheckIns
    .filter((c) => c.feelScore <= 2)
    .map(
      (c) =>
        `THIS-WEEK CRITICAL: ${c.sessionDate} (${c.sessionIntensity}) feelScore=${c.feelScore}${c.notes ? ` — "${c.notes}"` : ""}`
    );

  const doneMinutes = context.currentWeekDoneSessions.reduce(
    (sum, s) => sum + s.durationMin,
    0
  );

  const prompt: Record<string, unknown> = {
    weekStart: toDateStr(context.weekStart),
    today: context.todayStr,
    isReplan,
    ...(isReplan && { replanReason: context.replanReason }),
    user: {
      name: context.user.name,
      timezone: context.user.timezone,
      constraints: context.user.constraints,
    },
    goals: context.goals.map((g) => ({
      title: g.title,
      description: g.description,
      status: g.status,
    })),
    availabilityByDay,
    scheduleEvents: context.scheduleEvents.map((e) => ({
      startsAt: e.startsAt,
      endsAt: e.endsAt,
      kind: e.kind,
      note: e.note,
    })),
    // Current-week check-ins shown first — highest priority signal
    ...(context.thisWeekCheckIns.length > 0 && {
      thisWeekCheckIns: {
        note: "These are from the CURRENT week. Apply check-in rules immediately to remaining sessions.",
        entries: context.thisWeekCheckIns.map((c) => ({
          date: c.sessionDate,
          intensity: c.sessionIntensity,
          feelScore: c.feelScore,
          notes: c.notes,
        })),
        ...(thisWeekLowFeelWarnings.length > 0 && {
          CRITICAL_WARNINGS: thisWeekLowFeelWarnings,
        }),
      },
    }),
    previousWeek: {
      totalMinutes: context.previousSessions.reduce(
        (sum, s) => sum + s.durationMin,
        0
      ),
      sessions: previousSessionsSummary,
      ...(prevLowFeelWarnings.length > 0 && { lowFeelWarnings: prevLowFeelWarnings }),
    },
    ...(context.currentWeekDoneSessions.length > 0 && {
      thisWeekAlreadyDone: {
        note: "These dates are FROZEN — do not schedule anything on them.",
        totalDoneMinutes: doneMinutes,
        sessions: context.currentWeekDoneSessions,
      },
    }),
  };

  return JSON.stringify(prompt, null, 2);
}

function formatAvailability(
  windows: Array<{ dayOfWeek: string; timeStartMin: number; timeEndMin: number }>
): Record<string, string[]> {
  const byDay: Record<string, string[]> = {};
  for (const w of windows) {
    if (!byDay[w.dayOfWeek]) byDay[w.dayOfWeek] = [];
    byDay[w.dayOfWeek].push(`${minsToTime(w.timeStartMin)}–${minsToTime(w.timeEndMin)}`);
  }
  return byDay;
}

function minsToTime(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

function toDateStr(date: Date): string {
  return date.toISOString().split("T")[0];
}
