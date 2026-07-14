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
  sessions: Array<{
    scheduledDate: string;
    preferredSlot: string;
    planningType: string;
    durationMin: number;
    intensity: string;
    notes?: string;
  }>;
}

const SYSTEM_PROMPT = `You are an adaptive sports training assistant. Tailor the plan to the athlete's active goals in the \`goals\` array below — do not assume any specific discipline is targeted by default.

## Your task
Generate a structured 7-day training plan using the submit_plan tool.

## Session density — CRITICAL
- Default target is 4–5 training sessions per week. This is an active, fit athlete.
- 6 sessions is allowed ONLY when: (a) weeklyTrainingHoursTarget > 12h is set OR (b) a specific "high-volume" priority is in weeklyReview AND all recovery signals are green.
- NEVER schedule 6 consecutive training days with no rest — always include at least 1 full rest day.
- A week with only 2–3 sessions is almost always wrong — push for more.
- Rest days are intentional; do not leave days empty just to be conservative.

## Two-a-day sessions
- One session per day is the DEFAULT. Do not schedule two unless there is a clear reason.
- Two-a-days are acceptable ONLY when ALL of: (a) recovery signals are good (all active feelScores ≥ 5), (b) weekly volume target requires it, AND (c) sessions use different modalities (e.g. morning run + afternoon swim).
- Weekend two-a-days are more acceptable than weekday ones.
- Two sessions on the same day MUST use different time slots (e.g. morning + afternoon).
- Never schedule more than 2 sessions per day.

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

## Weekly structure (adapt to availability, constraints, and goal-driven prioritization below)
- Structure the week around the modalities implied by active goals, fixedSessions, and optionalSlots — do not force a modality that has no supporting goal or fixedSession.
- If a long-distance running goal is active (marathon, half marathon, etc.), include 1 long run — Saturday or Sunday morning, easy intensity, 90–150 min.
- If HYROX is an active goal, or a fixedSession/optionalSlot for it exists, include 1–2 HYROX group classes per week.
- Cycling or swimming optional for active recovery.
- Wednesday = office day — rest or short easy session only.
- Hard sessions (tempo, interval, HYROX group class at hard intensity) never on consecutive days.

## Goal-driven prioritization — REQUIRED
Use the \`goals\` array and the deterministic \`goalGuidance\` block (when present) to decide weekly focus.
- Address each active goal's discipline at least once this week if feasible.
- Bias total volume and session specificity toward the highest-weight goal in goalGuidance.perGoal. goalGuidance.primaryFocus is the nearest-dated goal among the top priority tier — it should generally get the week's key/hard session.
- If goalGuidance is absent (no active goals), fall back to a balanced general-fitness week using whatever modalities fixedSessions/optionalSlots/allowedModalities imply. Do not invent a marathon or HYROX focus that isn't backed by a goal or fixedSession.

## Taper rule
When goalGuidance.primaryFocus or any entry in goalGuidance.perGoal has phase = "taper" (its target date is within roughly the next 7–14 days):
- Reduce that discipline's weekly volume by roughly 30–50% versus a normal week.
- Preserve some intensity/sharpening — do not make the week all-easy.
- Add extra rest; do NOT start a new overload block for that discipline this week.

## Competing close goals
When two or more goals have overlapping near-term target dates (both in build or taper phase):
- Allocate session share by goalGuidance weight — the higher-weight goal gets the week's key/hard slot.
- The lower-weight goal gets a maintenance-only session.
- Prefer distinct modalities across the two so load is not double-counted on one movement pattern.

## Undated / far goals
Goals with no targetDate, or with phase = "base" (beyond roughly 8 weeks out), get maintenance-touch sessions only:
- Never taper for these.
- Never let them dominate the week over a nearer, higher-weight goal.

## Precedence order — CRITICAL
When signals conflict, apply in this order (highest wins):
1. Active injury / safety signals (see check-in and readiness rules below)
2. Weekly-review explicit priorities (see "Weekly review context")
3. Goal-derived weighting (goalGuidance, this section)
4. Default weekly structure above

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

## fixedSessions
When the context includes a fixedSessions array, each entry is a recurring session the user has pre-registered (e.g. a weekly HYROX group class). You MUST include every fixedSession in the plan with planningType: "fixed", on its exact date and slot. Do not skip, move, or merge them.

## safetyBlockedSessions
If the context includes a safetyBlockedSessions array, those fixed sessions were REMOVED by the safety system due to an active injury. Do NOT re-add them. Do NOT schedule any hard session on those dates. Treat those dates as rest or easy-only days.

## optionalSlots
When the context includes optionalSlots, each entry is a class or session slot the user *may* attend this week — the planner decides whether to include them based on overall load, recovery, and goals. If you include one, use planningType: "preferred". Never include more optional slots than makes sense for the week's total load.

## Daily readiness signals
When dailyReadiness is present, it contains readiness check-ins submitted on rest days or before sessions — NOT post-workout check-ins.
This is a LOWER-confidence signal than workout check-ins. Apply to REMAINING days only (never to past dates or already-done sessions).

- latestEntry: most recent readiness entry this week
- activeWarnings: entries with category != "ok" from today onwards; treat as signal to ease load
- affectsRemainingWeek: true when active warnings exist

Adjustment rules (apply in proportion; these are NOT hard safety blocks):
- category="injury" + feelScore ≤ 3: treat like a workout injury signal but at 60% confidence — no hard sessions next 2 days, avoid noted body part
- category="fatigue" + feelScore ≤ 3: bias next 1–2 sessions easier or shorter; no hard sessions tomorrow
- tags include "alcohol" or "poor_sleep": reduce tomorrow's session intensity one level or cut duration 15–20%
- tags include "stress" or "travel": prefer easy/moderate tomorrow; avoid hard
- feelScore ≥ 5: maintain planned load; do NOT overreact positively
Daily readiness does NOT trigger deterministic safety blocking — only workout check-ins do.

## familyConstraintsParsed
When present in the prompt, these are structured constraints parsed from the athlete's free-text input. Apply them as hard schedule constraints:
- type "blocked": do NOT schedule training on this day/slot
- type "available_only": on this day, ONLY use this slot for training; all other slots on that day are blocked
These override default availability windows for the specified day.

## User-defined constraints (from user.constraints)
- weeklyTrainingHoursTarget: if present, use as the total minutes target for the week (multiply by 60). Overrides the default 4-6 session guideline.
- allowedModalities: if present, use ONLY the listed modalities. Allowed values: "hyrox", "running", "cycling", "swimming". If absent, use all four.
- avoidFridayEvening: if true, do not schedule sessions on Friday evening slot.
- preferredEasyRideDurationMin: target duration for easy / recovery cycling sessions (e.g. 60). Use this INSTEAD of inventing a duration.
- preferredLongRideDurationMin: target duration for cycling long rides (e.g. 120). Use this INSTEAD of inventing a duration.
- preferredLongRunDurationMin: target duration for long runs (e.g. 110). Use this instead of the default range when set.
- minMeaningfulCyclingDurationMin: do not schedule cycling sessions shorter than this value.
- maxHyroxPerWeek: hard cap on HYROX group class sessions per week.
- preferredHyroxDays: array of day names (e.g. ["tue","thu"]). Prefer placing HYROX sessions on these days when possible.
- preferredEasyRunKm: target distance for easy and recovery runs. Use this INSTEAD of inventing a distance. Accepted values: 5, 10, 15, 21 km.
- preferredTempoRunKm: target distance for tempo and interval runs. Use this instead of generic ranges.
- preferredLongRunKm: target distance for the weekly long run. Use this instead of the default range.
CRITICAL — running distances:
  - When any preferred distance is set: use EXACTLY that value in the notes. Do NOT invent intermediate values (7, 8, 9, 12, 14, 18 km, etc.).
  - When NO preferences are set: default strictly to 10 km easy/tempo, 21 km long run. Do not choose other values.
  - Meaningful defaults are: 5 / 10 / 15 / 21 km. Easy flush runs (5 km) are fine when intentional. Arbitrary middling distances (7 km, 8 km) are not acceptable.

## planningType values
- generated: fully flexible (use for most sessions)
- preferred: preserve if possible (use for optional slots you decide to include)
- fixed: cannot be moved or removed

## Date context
"today" in the prompt is the user's current local date. Only schedule sessions on today or future dates — never in the past.
If "thisWeekAlreadyDone" is present, those sessions are already completed. Do NOT schedule anything on those dates. Subtract their minutes from your total volume budget.

## Strava execution deltas
When a done session includes an "executionDelta" field, use it as a light, non-overriding signal:
- clearly_short or slightly_short: the planned load was not fully absorbed — do not build further on top of it
- interrupted: split or high pause-ratio session — avoid over-crediting it as a full stimulus
- hilly_variant: elevation added demand beyond time/distance — treat as slightly more demanding
- longer_than_planned: athlete delivered more than planned — note the higher accumulated load
- matched: execution matched plan, no adjustment needed
Do not invent physiology claims. Do not downgrade sessions dramatically based on this alone — it is context, not a hard rule.

## Active issues vs resolved issues — CRITICAL distinction
Check-ins are labeled either ACTIVE or RESOLVED.
- ACTIVE (resolvedAt is null): treat as a current, live issue. Apply full check-in rules.
- RESOLVED (resolvedAt is set): the athlete confirmed this issue is no longer relevant. Do not downgrade sessions based on resolved issues. Acknowledge recovery — you may even increase load slightly if all other signals are green.

## Check-in signals — apply ALWAYS, not only on replan
Read thisWeekCheckIns and previousWeek.lowFeelWarnings BEFORE planning any sessions.
Only ACTIVE check-in warnings trigger the protective rules below.

thisWeekCheckIns are from the CURRENT week — they are the highest-priority signal.
Each check-in now includes a pre-computed "category" field: "injury", "fatigue", or "ok".

Rules for ACTIVE thisWeekCheckIns:
1. category="injury": MANDATORY — no hard sessions for the NEXT 2 days after that date; do NOT schedule the affected movement pattern (running if leg/knee, upper body if shoulder/wrist, etc.)
2. category="fatigue": the next 1–2 sessions must be easy or rest only; do not apply injury-level blocking
3. Two or more ACTIVE entries with category != "ok": reduce remaining weekly volume 15–20%; no hard sessions for the rest of the week
4. All entries feelScore ≥ 5: you may maintain or add a modest +5–10% volume — one good session does not justify a large load spike

previousWeek (recentCheckIns) ACTIVE signals apply the same rules at lower weight — current-week signals always override.

## Weekly review context
When weeklyReview is present, treat it as the athlete's direct input for this planning cycle:
- recoveryScore (1–6): 1–2 = treat like a fatigue signal (reduce load, no hard sessions); 5–6 = can maintain or slightly increase; 3–4 = neutral, no special adjustment
- priorities: focus areas the athlete selected — apply ALL of them:
  - "More HYROX this week" → include ≥ 2 HYROX sessions if schedule allows
  - "Easy recovery week" → max 4 sessions total, all easy or moderate, reduce volume ~15%
  - "Focus on running volume" → include ≥ 3 runs; long run is non-negotiable
  - "Marathon pace work" → include ≥ 1 tempo or interval run at moderate/hard
  - "Long ride priority" → include ≥ 1 cycling session ≥ 90 min
  - "Balanced" → follow default weekly structure
- familyConstraints: additional blocks or reduced availability beyond scheduleEvents — respect them strictly
- trainingPreferencesText: athlete's raw free-form text — the structured interpretation is in explicitPreferenceConstraints; use the raw text only for context not captured by the structured fields

## Explicit preference constraints (explicitPreferenceConstraints)
When this object appears in the prompt, it contains preferences parsed deterministically from the athlete's free text (in any language).

- dayRequests: STRONG scheduling requests — treat as near-fixed sessions. Only skip if a safety rule or hard schedule block prevents it. If you cannot satisfy one, state the reason explicitly in your focusSummary.
- desiredModalities: include at least minCount sessions of that modality this week. If maxCount is set, do not exceed it.
- sacrificedModalities: these are the lowest-priority modalities — omit them first if you need to reduce total load or cannot fit everything.
- availabilityHints: additional slot-level blocks. Do not schedule sessions in those slots on the specified days.

These constraints are also enforced deterministically after your response. Your initial plan should already satisfy them — the post-processor corrects only genuine misses.`;

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
      checkIn: ci
        ? {
            feelScore: ci.feelScore,
            notes: ci.notes,
            category: ci.category,
            status: ci.resolvedAt ? "RESOLVED" : "ACTIVE",
          }
        : null,
    };
  });

  // Only ACTIVE (unresolved) non-ok check-ins from previous week carry weight
  const prevLowFeelWarnings = context.recentCheckIns
    .filter((c) => c.category !== "ok" && !c.resolvedAt)
    .map(
      (c) =>
        `PREV-WEEK [ACTIVE]: ${c.sessionDate} (${c.sessionIntensity}) feelScore=${c.feelScore}/6 category=${c.category}${c.notes ? ` — "${c.notes}"` : ""}`
    );

  const thisWeekLowFeelWarnings = context.thisWeekCheckIns
    .filter((c) => c.category !== "ok")
    .map((c) => {
      const status = c.resolvedAt ? "RESOLVED" : "ACTIVE";
      return `THIS-WEEK [${status}]: ${c.sessionDate} (${c.sessionIntensity}) feelScore=${c.feelScore}/6 category=${c.category}${c.notes ? ` — "${c.notes}"` : ""}`;
    });

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
      ...(g.discipline && { discipline: g.discipline }),
      ...(g.targetDate && { targetDate: toDateStr(g.targetDate) }),
      ...(g.priority != null && { priority: g.priority }),
      status: g.status,
    })),
    ...(context.goalGuidance && context.goalGuidance.perGoal.length > 0 && {
      goalGuidance: {
        note: "Deterministically computed goal weighting — use to decide discipline focus, session allocation, and taper decisions per the 'Goal-driven prioritization' rules.",
        ...(context.goalGuidance.primaryFocus && {
          primaryFocus: {
            title: context.goalGuidance.primaryFocus.title,
            discipline: context.goalGuidance.primaryFocus.discipline,
            daysUntil: context.goalGuidance.primaryFocus.daysUntil,
            phase: context.goalGuidance.primaryFocus.phase,
          },
        }),
        perGoal: context.goalGuidance.perGoal.map((g) => ({
          title: g.title,
          discipline: g.discipline,
          daysUntil: g.daysUntil,
          phase: g.phase,
          weight: g.weight,
        })),
        ...(context.goalGuidance.taperGoal && {
          taperGoal: {
            title: context.goalGuidance.taperGoal.title,
            discipline: context.goalGuidance.taperGoal.discipline,
            daysUntil: context.goalGuidance.taperGoal.daysUntil,
          },
        }),
      },
    }),
    ...(context.fixedSessions.length > 0 && {
      fixedSessions: {
        note: "These sessions are FIXED. Include each one exactly as specified with planningType: 'fixed'.",
        sessions: context.fixedSessions,
      },
    }),
    ...(context.safetyBlockedSessions && context.safetyBlockedSessions.length > 0 && {
      safetyBlockedSessions: {
        note: "These fixed sessions were CANCELLED by the safety system due to active injury. Do NOT include them. No hard sessions on these dates.",
        sessions: context.safetyBlockedSessions,
      },
    }),
    ...(context.optionalSlots.length > 0 && {
      optionalSlots: {
        note: "These are class/session slots available this week. Include them (planningType: 'preferred') only if they fit the overall load and recovery picture.",
        slots: context.optionalSlots,
      },
    }),
    availabilityByDay,
    scheduleEvents: context.scheduleEvents.map((e) => ({
      startsAt: e.startsAt,
      endsAt: e.endsAt,
      kind: e.kind,
      note: e.note,
    })),
    ...(context.weeklyReview && {
      weeklyReview: {
        note: "Direct athlete input for this planning cycle — highest priority after active injury signals.",
        ...context.weeklyReview,
      },
    }),
    ...(context.parsedPreferences &&
      (context.parsedPreferences.explicitDayRequests.length > 0 ||
        context.parsedPreferences.desiredModalities.length > 0 ||
        context.parsedPreferences.sacrificedModalities.length > 0 ||
        (context.parsedPreferences.availabilityHints?.length ?? 0) > 0) && {
      explicitPreferenceConstraints: {
        note: "Parsed from the athlete's free-text preferences (language-agnostic). Day+modality pairs are STRONG scheduling requests — treat like near-fixed sessions. Only skip if safety or a hard schedule block prevents it. If you skip one, state why in focusSummary.",
        ...(context.parsedPreferences.explicitDayRequests.length > 0 && {
          dayRequests: context.parsedPreferences.explicitDayRequests.map((r) => ({
            day: r.day,
            modality: r.modality,
            ...(r.intensityHint && { intensityHint: r.intensityHint }),
            ...(r.slotHint && { slotHint: r.slotHint }),
            instruction: `Schedule ${r.modality.toUpperCase()} on ${r.day}${r.slotHint ? ` (${r.slotHint})` : ""}`,
          })),
        }),
        ...(context.parsedPreferences.desiredModalities.length > 0 && {
          desiredModalities: context.parsedPreferences.desiredModalities.map((d) => ({
            modality: d.modality,
            minCount: d.minCount,
            ...(d.maxCount && { maxCount: d.maxCount }),
            ...(d.intensityHint && { intensityHint: d.intensityHint }),
            ...(d.preferredSlot && { preferredSlot: d.preferredSlot }),
            ...(d.preferredDays?.length && { preferredDays: d.preferredDays }),
            instruction: `Include at least ${d.minCount}${d.maxCount ? ` (max ${d.maxCount})` : ""} ${d.modality} session${d.minCount !== 1 ? "s" : ""}${d.intensityHint ? ` at ${d.intensityHint} intensity` : ""}`,
          })),
        }),
        ...(context.parsedPreferences.sacrificedModalities.length > 0 && {
          sacrificedModalities: context.parsedPreferences.sacrificedModalities,
          sacrificeNote: "These are lowest priority — omit them first if total load needs to be reduced.",
        }),
        ...(context.parsedPreferences.availabilityHints?.length && {
          availabilityHints: context.parsedPreferences.availabilityHints.map((h) => ({
            day: h.day,
            blockedSlots: h.blockedSlots,
            note: `On ${h.day}, do not schedule sessions in: ${h.blockedSlots.join(", ")}`,
          })),
        }),
      },
    }),
    ...(context.weeklyReview?.parsedConstraints && context.weeklyReview.parsedConstraints.length > 0 && {
      familyConstraintsParsed: {
        note: "Structured constraints parsed from familyConstraints text. Apply as hard schedule rules.",
        constraints: context.weeklyReview.parsedConstraints.map((c) => ({
          day: c.day,
          ...(c.slot && { slot: c.slot }),
          type: c.type,
          meaning: c.type === "available_only"
            ? `On ${c.day}, only schedule training in the ${c.slot ?? "any"} slot`
            : `No training on ${c.day}${c.slot ? ` during ${c.slot}` : " (all day)"}`,
        })),
      },
    }),
    ...(context.readinessSummary && {
      dailyReadiness: {
        note: "Rest-day / morning readiness signals this week. Apply to remaining days only.",
        latestEntry: context.readinessSummary.latestEntry,
        ...(context.readinessSummary.activeWarnings.length > 0 && {
          activeWarnings: context.readinessSummary.activeWarnings,
        }),
        affectsRemainingWeek: context.readinessSummary.affectsRemainingWeek,
      },
    }),
    ...(context.thisWeekCheckIns.length > 0 && {
      thisWeekCheckIns: {
        note: "From the CURRENT week. ACTIVE issues apply full protective rules. RESOLVED issues are cleared.",
        entries: context.thisWeekCheckIns.map((c) => ({
          date: c.sessionDate,
          intensity: c.sessionIntensity,
          feelScore: c.feelScore,
          notes: c.notes,
          category: c.category,
          status: c.resolvedAt ? "RESOLVED" : "ACTIVE",
        })),
        ...(thisWeekLowFeelWarnings.length > 0 && {
          warnings: thisWeekLowFeelWarnings,
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
        sessions: context.currentWeekDoneSessions.map((s) => {
          if (!s.executionDelta || s.executionDelta.quality === "matched") {
            return { date: s.date, durationMin: s.durationMin, intensity: s.intensity, notes: s.notes, status: s.status };
          }
          const delta = s.executionDelta;
          const distanceNote =
            delta.actualDistanceM != null && delta.plannedDistanceM != null
              ? `${(delta.actualDistanceM / 1000).toFixed(1)}km actual vs ${(delta.plannedDistanceM / 1000).toFixed(0)}km planned`
              : undefined;
          return {
            date: s.date,
            durationMin: s.durationMin,
            intensity: s.intensity,
            notes: s.notes,
            status: s.status,
            executionDelta: {
              quality: delta.quality,
              ...(delta.durationDeltaMin !== 0 && { durationDeltaMin: delta.durationDeltaMin }),
              ...(distanceNote && { distanceNote }),
              ...(delta.elevationPerKm != null && delta.elevationPerKm >= 20 && {
                elevationPerKm: Math.round(delta.elevationPerKm),
              }),
            },
          };
        }),
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
