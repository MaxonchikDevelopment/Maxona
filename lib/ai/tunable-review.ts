import Anthropic from "@anthropic-ai/sdk";
import type { TunableDefaults, WeekSummary } from "@prisma/client";
import type { WeekHistoryEntry } from "./adapter";

export interface TunableReviewProposal {
  hrDisciplinePct: number;
  efStopThresholdPct: number;
  jumpRatioCeiling: number;
  rationale: string;
}

interface SubmitTunablesInput {
  hrDisciplinePct: number;
  efStopThresholdPct: number;
  jumpRatioCeiling: number;
  rationale: string;
}

const SUBMIT_TUNABLES_TOOL = {
  name: "submit_tunables",
  description: "Submit the revised weekly tunable defaults",
  input_schema: {
    type: "object",
    properties: {
      hrDisciplinePct: {
        type: "number",
        description: "Share of planned session time expected to sit inside the prescribed HR zone before a session is flagged as off-target.",
      },
      efStopThresholdPct: {
        type: "number",
        description: "Aerobic decoupling % above which a long/key session is flagged as a stop-signal.",
      },
      jumpRatioCeiling: {
        type: "number",
        description: "Max allowed week-over-week volume increase ratio (mirrors the deterministic MaxWeeklyVolumeIncreaseRule).",
      },
      rationale: {
        type: "string",
        description:
          "Explanation for the revised (or unchanged) values. MUST cite specific numbers from this week's data or weekHistory — not generic language.",
      },
    },
    required: ["hrDisciplinePct", "efStopThresholdPct", "jumpRatioCeiling", "rationale"],
  },
} as const;

const SYSTEM_PROMPT = `You are reviewing an adaptive athlete's weekly tunable training thresholds after a completed training week.

## What each threshold means
- hrDisciplinePct: share of planned session time expected to sit inside the prescribed HR zone before a session is flagged as off-target. Conservative starting point: 80.
- efStopThresholdPct: aerobic decoupling % (see avgDecouplingPct in the data below) above which a long/key session is flagged as a stop-signal. Validated FIT reference runs sit at 6.63%/10.54%, so 8% sits between them.
- jumpRatioCeiling: max allowed week-over-week volume increase, mirrors the existing MaxWeeklyVolumeIncreaseRule (+10%, i.e. 1.1) from the deterministic rules engine.

## Your task
Given the just-completed week's WeekSummary and recent weekHistory trend, decide whether any of these three values should shift, and submit your decision via submit_tunables.

## Rules
- Revise gradually — this is a slow-moving athlete profile, not a per-week reset. Do not swing values wildly week to week.
- If the week's data doesn't clearly suggest a change, it is fine and expected to keep values close to or equal to the current values.
- Base your rationale on the actual data provided: cite specific numbers (e.g. adherence %, avgDecouplingPct, avgEfWhole, hardDone/hardPlanned, mainLimiter, carryForward entries) from weekSummary or weekHistory. Do not write generic language like "the athlete seems fine" — name the numbers that led to your decision.
- A rising avgDecouplingPct trend across weekHistory is a fatigue/overreach signal — consider a lower efStopThresholdPct (more sensitive stop signal) and/or a lower jumpRatioCeiling.
- Strong, consistent adherence with clean execution and no fatigue/injury signals across weekHistory can support a modest increase in jumpRatioCeiling or hrDisciplinePct.
- A recurring mainLimiter (fatigue, injury) across weeks should bias toward more conservative (lower) values, not more aggressive ones.`;

function buildUserPrompt(
  current: TunableDefaults,
  weekSummary: WeekSummary,
  weekHistory: WeekHistoryEntry[]
): string {
  const signals = (weekSummary.signals ?? {}) as Record<string, unknown>;

  const prompt = {
    currentTunables: {
      hrDisciplinePct: current.hrDisciplinePct,
      efStopThresholdPct: current.efStopThresholdPct,
      jumpRatioCeiling: current.jumpRatioCeiling,
      rationale: current.rationale,
    },
    justCompletedWeek: {
      weekStart: weekSummary.weekStart.toISOString().split("T")[0],
      weekEnd: weekSummary.weekEnd.toISOString().split("T")[0],
      planned: weekSummary.planned,
      done: weekSummary.done,
      skipped: weekSummary.skipped,
      adherenceByCount: weekSummary.adherenceByCount,
      hardPlanned: weekSummary.hardPlanned,
      hardDone: weekSummary.hardDone,
      avgFeelScore: weekSummary.avgFeelScore,
      signals,
      carryForward: weekSummary.carryForward,
    },
    weekHistory: weekHistory.map((w) => ({
      weekStart: w.weekStart,
      adherenceByCount: w.adherenceByCount,
      hardDone: w.hardDone,
      hardPlanned: w.hardPlanned,
      avgFeelScore: w.avgFeelScore,
      mainLimiter: w.mainLimiter,
      carryForward: w.carryForward,
      ...(w.avgDecouplingPct != null && {
        avgDecouplingPct: w.avgDecouplingPct,
        decouplingSessionCount: w.decouplingSessionCount,
      }),
      ...(w.avgEfWhole != null && {
        avgEfWhole: w.avgEfWhole,
        efSessionCount: w.efSessionCount,
      }),
    })),
  };

  return JSON.stringify(prompt, null, 2);
}

// Bounds enforced in code, never trusted from the LLM. hrDisciplinePct and
// jumpRatioCeiling bound around the INITIAL_DEFAULTS starting points in
// lib/planner/tunable-defaults.ts; efStopThresholdPct's [4, 15] range keeps
// both validated FIT reference points (6.63%, 10.54%) comfortably inside it.
const BOUNDS = {
  hrDisciplinePct: { min: 50, max: 95 },
  efStopThresholdPct: { min: 4, max: 15 },
  jumpRatioCeiling: { min: 1.0, max: 1.2 },
} as const;

export function clampTunableProposal(proposal: TunableReviewProposal): TunableReviewProposal {
  const clampNotes: string[] = [];

  const clamp = (key: keyof typeof BOUNDS, value: number): number => {
    const { min, max } = BOUNDS[key];
    const clamped = Math.min(max, Math.max(min, value));
    if (clamped !== value) {
      clampNotes.push(`${key} clamped from ${value} to ${clamped} (bounds [${min}, ${max}])`);
    }
    return clamped;
  };

  const hrDisciplinePct = clamp("hrDisciplinePct", proposal.hrDisciplinePct);
  const efStopThresholdPct = clamp("efStopThresholdPct", proposal.efStopThresholdPct);
  const jumpRatioCeiling = clamp("jumpRatioCeiling", proposal.jumpRatioCeiling);

  const rationale =
    clampNotes.length > 0
      ? `${proposal.rationale}\n\n[Guardrail clamp applied: ${clampNotes.join("; ")}]`
      : proposal.rationale;

  return { hrDisciplinePct, efStopThresholdPct, jumpRatioCeiling, rationale };
}

export async function reviewTunableDefaults(
  current: TunableDefaults,
  weekSummary: WeekSummary,
  weekHistory: WeekHistoryEntry[]
): Promise<TunableReviewProposal> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools: [SUBMIT_TUNABLES_TOOL],
    tool_choice: { type: "tool", name: "submit_tunables" },
    messages: [{ role: "user", content: buildUserPrompt(current, weekSummary, weekHistory) }],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("reviewTunableDefaults: expected tool_use block in response");
  }

  const input = toolUse.input as SubmitTunablesInput;

  return {
    hrDisciplinePct: input.hrDisciplinePct,
    efStopThresholdPct: input.efStopThresholdPct,
    jumpRatioCeiling: input.jumpRatioCeiling,
    rationale: input.rationale,
  };
}
