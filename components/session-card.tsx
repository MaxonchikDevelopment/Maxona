"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "motion/react";
import { stripMarkdownBold } from "@/lib/format-bullets";
import { formatIntensity, formatSlot } from "@/lib/format-labels";
import { StravaPanel } from "@/components/strava-panel";
import type { StravaLinkProp, StravaActivitySummary } from "@/components/strava-panel";
import { ExecutionSummaryBlock } from "@/components/execution-summary-block";
import { WorkoutFeedbackSection } from "@/components/workout-feedback-section";
import type { WorkoutFeedbackProp } from "@/components/workout-feedback-section";
import { SessionAnalytics } from "@/components/session-analytics";
import { AnalyzeStreamButton } from "@/components/analyze-stream-button";
import type { HrAnalytics } from "@/lib/analytics/hr-stream";
import type { NutritionAdvice } from "@/lib/ai/nutrition-advice";

export type CheckInProp = {
  id: string;
  feelScore: number;
  notes: string | null;
  coachAdvice: string | null;
  resolvedAt: string | null;
};

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

export type WorkoutPlanProp = {
  id: string;
  planType: string;
  goal: string;
  target: string | null;
  blocks: WorkoutBlock[];
  rules: string[];
  alternatives: string[] | null;
  summary: string | null;
};

export type SessionProp = {
  id: string;
  scheduledDate: string;
  preferredSlot: string;
  planningType: string;
  status: string;
  durationMin: number;
  intensity: string;
  notes: string | null;
  checkIn: CheckInProp | null;
  stravaLinks?: StravaLinkProp[];
  stravaConnected?: boolean;
  workoutPlan?: WorkoutPlanProp | null;
  workoutFeedback?: WorkoutFeedbackProp | null;
  hrAnalytics?: HrAnalytics | null;
  nutritionAdvice?: NutritionAdvice | null;
};

// Keyword list mirrors lib/checkin-utils.ts — specific injury/pain indicators only
const INJURY_KEYWORDS = [
  "injury", "injured",
  "pain", "sharp pain", "pulled",
  "strain", "sprain", "tendon", "ligament",
  "knee", "ankle", "shin",
  "боль", "болит", "болят", "травм", "колен", "лодыжк", "голен",
  "schmerz", "schmerzen", "verletzt", "verletzung", "knie", "knöchel",
];

function classifyCheckIn(feelScore: number, notes: string | null): "injury" | "fatigue" | "ok" {
  if (feelScore >= 4) return "ok";
  const lower = (notes ?? "").toLowerCase();
  if (INJURY_KEYWORDS.some((kw) => lower.includes(kw))) return "injury";
  return "fatigue";
}

function staticHint(
  category: "injury" | "fatigue" | "ok",
  feelScore: number
): string | null {
  if (category === "injury") return "Possible injury noted — mark resolved when feeling better.";
  if (category === "fatigue") return "Tough day — load adjusted for next session.";
  if (feelScore >= 5) return "Strong session — plan unchanged.";
  return null;
}

function fmtCompactTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const min = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h${min > 0 ? ` ${min}m` : ""}` : `${min}m`;
}

function fmtCompactDist(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

function buildCompactExecLine(a: StravaActivitySummary): string {
  const parts: string[] = ["Actual"];
  if (a.movingTime > 0) parts.push(fmtCompactTime(a.movingTime));
  if (a.distance > 0) parts.push(fmtCompactDist(a.distance));
  if (a.averageHeartrate) parts.push(`HR avg ${Math.round(a.averageHeartrate)}`);
  return parts.join(" · ");
}

function CompactMetricPills({ links }: { links: StravaLinkProp[] }) {
  const primary = links.find((l) => l.isPrimary) ?? links[0];
  if (!primary) return null;
  const a = primary.activity;

  const pills: Array<{ label: string; value: string }> = [];

  if (a.distance > 0) {
    const km = a.distance / 1000;
    pills.push({ label: "Dist", value: km >= 1 ? `${km.toFixed(1)} km` : `${Math.round(a.distance)} m` });
  }
  if (a.movingTime > 0) {
    const h = Math.floor(a.movingTime / 3600);
    const m = Math.floor((a.movingTime % 3600) / 60);
    pills.push({ label: "Time", value: h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ""}` : `${m} min` });
  }
  if (a.distance > 0 && a.movingTime > 0) {
    const st = a.sportType.toLowerCase();
    if (st.includes("run")) {
      const secPerKm = a.movingTime / (a.distance / 1000);
      const pm = Math.floor(secPerKm / 60);
      const ps = Math.round(secPerKm % 60);
      pills.push({ label: "Pace", value: `${pm}:${String(ps).padStart(2, "0")} /km` });
    } else {
      const kph = (a.distance / 1000) / (a.movingTime / 3600);
      pills.push({ label: "Speed", value: `${kph.toFixed(1)} km/h` });
    }
  }
  if (a.averageHeartrate) {
    pills.push({ label: "Avg HR", value: `${Math.round(a.averageHeartrate)} bpm` });
  }
  if (a.totalElevationGain > 20) {
    pills.push({ label: "Elev", value: `+${Math.round(a.totalElevationGain)} m` });
  }

  if (pills.length === 0) return null;

  return (
    <div className="rounded-xl bg-zinc-50 border border-zinc-100 px-3 py-2.5">
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {pills.slice(0, 5).map((pill) => (
          <div key={pill.label} className="flex flex-col gap-0.5">
            <span className="text-[9px] font-semibold uppercase tracking-widest text-zinc-400">
              {pill.label}
            </span>
            <span className="text-sm font-semibold text-zinc-800 tabular-nums leading-none">
              {pill.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function WorkoutPlanBlock({
  plan,
  sessionId,
  onRegenerate,
  regenerating,
  nutritionAdvice,
}: {
  plan: WorkoutPlanProp;
  sessionId: string;
  onRegenerate: () => void;
  regenerating: boolean;
  nutritionAdvice?: NutritionAdvice | null;
}) {
  const [open, setOpen] = useState(false);
  const previewBlocks = plan.blocks.slice(0, 3);

  return (
    <div className="border-t border-zinc-100 pt-2.5 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-indigo-500">
          Workout plan
        </span>
        <div className="flex items-center gap-2">
          <Link
            href={`/sessions/${sessionId}`}
            className="text-[10px] text-indigo-400 underline hover:text-indigo-600 transition-colors"
          >
            Coach view
          </Link>
          <button
            onClick={onRegenerate}
            disabled={regenerating}
            className="text-[10px] text-zinc-400 underline disabled:opacity-40 hover:text-zinc-600 transition-colors"
          >
            {regenerating ? "Generating…" : "Regenerate"}
          </button>
        </div>
      </div>

      <p className="text-xs font-medium text-zinc-700">{plan.goal}</p>
      {plan.target && (
        <p className="text-xs font-medium text-indigo-600">{plan.target}</p>
      )}
      <p className="text-[10px] text-zinc-400 leading-relaxed">
        {[
          ...previewBlocks.map((b) => `${b.label} ${b.durationMin}m`),
          ...(plan.blocks.length > 3 ? [`+${plan.blocks.length - 3} more`] : []),
        ].join(" · ")}
      </p>

      <button
        onClick={() => setOpen((v) => !v)}
        className="text-[10px] text-indigo-400 underline hover:text-indigo-600 transition-colors"
      >
        {open ? "Hide details" : "Show full plan"}
      </button>

      {open && (
        <div className="space-y-2">
          <div className="space-y-1.5">
            {plan.blocks.map((block, i) => (
              <div key={i} className="rounded-xl bg-zinc-50 border border-zinc-100 px-2.5 py-1.5">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs font-medium text-zinc-700">{block.label}</span>
                  <span className="text-[10px] text-zinc-400">— {block.durationMin}m</span>
                  {block.zone && (
                    <span className="text-[10px] text-indigo-400">{block.zone}</span>
                  )}
                </div>
                <p className="text-[11px] text-zinc-500 mt-0.5">{block.description}</p>
              </div>
            ))}
          </div>
          {plan.rules.length > 0 && (
            <div className="space-y-0.5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">Rules</p>
              {plan.rules.map((r, i) => (
                <p key={i} className="text-[11px] text-zinc-500">• {r}</p>
              ))}
            </div>
          )}
          {plan.alternatives && plan.alternatives.length > 0 && (
            <div className="space-y-0.5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">Alternatives</p>
              {plan.alternatives.map((a, i) => (
                <p key={i} className="text-[11px] text-zinc-500">• {a}</p>
              ))}
            </div>
          )}
          {nutritionAdvice && (
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 px-3 py-2 space-y-0.5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-600">Fueling</p>
              {nutritionAdvice.before.map((b, i) => (
                <p key={i} className="text-[11px] text-emerald-800">
                  <span className="font-medium">Before:</span> {b}
                </p>
              ))}
              {nutritionAdvice.during.map((d, i) => (
                <p key={i} className="text-[11px] text-emerald-800">
                  <span className="font-medium">During:</span> {d}
                </p>
              ))}
              {nutritionAdvice.after.map((a, i) => (
                <p key={i} className="text-[11px] text-emerald-800">
                  <span className="font-medium">After:</span> {a}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function SessionCard({
  session,
  todayStr,
}: {
  session: SessionProp;
  todayStr?: string;
}) {
  const router = useRouter();
  const isPast = todayStr ? session.scheduledDate < todayStr : false;
  const shouldCollapse =
    isPast &&
    (session.status === "done" || session.status === "skipped" || !!session.checkIn);
  const [checkIn, setCheckIn] = useState<CheckInProp | null>(session.checkIn);
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const [feelScore, setFeelScore] = useState(session.checkIn?.feelScore ?? 4);
  const [notes, setNotes] = useState(session.checkIn?.notes ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(session.status === "done" || !!session.checkIn);
  const [isSkipped, setIsSkipped] = useState(session.status === "skipped");
  const [skipPending, setSkipPending] = useState(false);
  const [workoutPlan, setWorkoutPlan] = useState<WorkoutPlanProp | null>(session.workoutPlan ?? null);
  const [feedbackGenerating, setFeedbackGenerating] = useState(false);
  const [showWorkoutPlan, setShowWorkoutPlan] = useState(false);
  const nutritionAdvice = session.nutritionAdvice ?? null;
  const [planGenerating, setPlanGenerating] = useState(false);
  const [cardExpanded, setCardExpanded] = useState(!shouldCollapse);
  const isFuture = todayStr ? session.scheduledDate > todayStr : false;

  // Primary Strava activity ID — for AnalyzeStreamButton when stream is missing
  const primaryActivityId = session.stravaLinks?.length
    ? (session.stravaLinks.find((l) => l.isPrimary) ?? session.stravaLinks[0]).activity.id
    : null;

  async function triggerFeedbackIfReady(hasStrava: boolean) {
    const hasCheckIn = !!checkIn || done;
    if (!hasStrava || !hasCheckIn) return;
    setFeedbackGenerating(true);
    try {
      await fetch(`/api/sessions/${session.id}/workout-feedback`, { method: "POST" });
    } catch {
      // non-fatal
    } finally {
      setFeedbackGenerating(false);
    }
  }

  async function submitCheckIn() {
    setSubmitting(true);
    const res = await fetch(`/api/sessions/${session.id}/checkin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feelScore, notes }),
    });
    const data = await res.json();
    setCheckIn(data);
    setDone(true);
    setOpen(false);
    setEditing(false);
    setSubmitting(false);

    // Auto-generate after-workout feedback if Strava is already attached
    if ((session.stravaLinks?.length ?? 0) > 0) {
      await triggerFeedbackIfReady(true);
    }
    router.refresh();
  }

  async function updateCheckIn() {
    if (!checkIn) return;
    setSubmitting(true);
    const res = await fetch(`/api/sessions/${session.id}/checkin`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feelScore, notes }),
    });
    const data = await res.json();
    setCheckIn(data);
    setEditing(false);
    setOpen(false);
    setSubmitting(false);

    // Refresh feedback if Strava is attached
    if ((session.stravaLinks?.length ?? 0) > 0) {
      await triggerFeedbackIfReady(true);
    }
    router.refresh();
  }

  async function resolveIssue() {
    if (!checkIn) return;
    setSubmitting(true);
    const res = await fetch(`/api/sessions/${session.id}/checkin`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolved: true }),
    });
    const data = await res.json();
    setCheckIn(data);
    setSubmitting(false);
    router.refresh();
  }

  async function reopenIssue() {
    if (!checkIn) return;
    setSubmitting(true);
    const res = await fetch(`/api/sessions/${session.id}/checkin`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolved: false }),
    });
    const data = await res.json();
    setCheckIn(data);
    setSubmitting(false);
    router.refresh();
  }

  async function reanalyzeAdvice() {
    if (!checkIn) return;
    setSubmitting(true);
    const res = await fetch(`/api/sessions/${session.id}/checkin`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feelScore: checkIn.feelScore, notes: checkIn.notes }),
    });
    const data = await res.json();
    setCheckIn(data);
    setSubmitting(false);
  }

  async function handleSkip() {
    setSkipPending(true);
    try {
      const res = await fetch(`/api/sessions/${session.id}/skip`, { method: "POST" });
      if (res.ok) {
        setIsSkipped(true);
        router.refresh();
      }
    } finally {
      setSkipPending(false);
    }
  }

  async function generatePlan() {
    setPlanGenerating(true);
    try {
      const res = await fetch(`/api/sessions/${session.id}/workout-plan`, { method: "POST" });
      const data = await res.json();
      if (data && data.id) {
        setWorkoutPlan({
          id: data.id,
          planType: data.planType,
          goal: data.goal,
          target: data.target,
          blocks: data.blocks as WorkoutBlock[],
          rules: data.rules as string[],
          alternatives: data.alternatives as string[] | null,
          summary: data.summary,
        });
      }
    } catch {
      // non-fatal
    } finally {
      setPlanGenerating(false);
    }
  }

  function startEdit() {
    setFeelScore(checkIn?.feelScore ?? 4);
    setNotes(checkIn?.notes ?? "");
    setEditing(true);
    setOpen(true);
  }

  // Called by StravaPanel after an activity is attached
  async function handleActivityAttached() {
    // Auto-generate feedback if check-in already exists
    if (checkIn || done) {
      await triggerFeedbackIfReady(true);
      router.refresh();
    }
  }

  const isResolved = !!checkIn?.resolvedAt;
  const category = checkIn ? classifyCheckIn(checkIn.feelScore, checkIn.notes) : "ok";
  const isInjury = category === "injury";
  const coachAdvice = checkIn?.coachAdvice ?? null;
  const hint = !isResolved && !coachAdvice ? staticHint(category, checkIn?.feelScore ?? 4) : null;
  const isPositiveAdvice = (checkIn?.feelScore ?? 0) >= 5;

  const intensityBorder =
    session.intensity === "hard"
      ? "border-l-red-400"
      : session.intensity === "easy"
      ? "border-l-emerald-400"
      : session.intensity === "moderate"
      ? "border-l-amber-400"
      : "border-l-zinc-200";

  // ── Compact collapsed card (past done/skipped sessions) ──────────────────
  if (!cardExpanded) {
    const primaryLink =
      session.stravaLinks?.find((l) => l.isPrimary) ?? session.stravaLinks?.[0] ?? null;
    const compactExecLine = primaryLink ? buildCompactExecLine(primaryLink.activity) : null;
    const coachTakeaway =
      (session.workoutFeedback?.summary ? stripMarkdownBold(session.workoutFeedback.summary) : null) ??
      (checkIn?.coachAdvice
        ? stripMarkdownBold(checkIn.coachAdvice.split("\n")[0].replace(/^[•·*-]\s*/, "").trim())
        : null);
    const hasBadges = (session.stravaLinks?.length ?? 0) > 0 || isInjury;

    return (
      <motion.div
        whileHover={{ y: -1 }}
        whileTap={{ scale: 0.98 }}
        transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
        className={`rounded-2xl bg-white border border-zinc-100 border-l-[3px] ${intensityBorder} shadow-card px-3 py-2.5 space-y-1`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <span className="text-sm font-semibold text-zinc-800">{formatIntensity(session.intensity)}</span>
            <span className="text-xs text-zinc-400">
              {session.durationMin} min · {formatSlot(session.preferredSlot)}
            </span>
            {session.planningType === "fixed" && (
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500">fixed</span>
            )}
            {session.planningType === "preferred" && (
              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-500">optional</span>
            )}
            {session.planningType === "manual" && (
              <span className="rounded-full bg-purple-50 px-2 py-0.5 text-[10px] font-medium text-purple-500">manual</span>
            )}
            <span
              className={`text-xs font-medium ${
                (session.status === "skipped" || isSkipped)
                  ? "text-zinc-400"
                  : isResolved
                  ? "text-zinc-400"
                  : "text-emerald-600"
              }`}
            >
              {(session.status === "skipped" || isSkipped)
                ? "Skipped"
                : isResolved
                ? "Done · resolved"
                : checkIn
                ? `Done · ${checkIn.feelScore}/6`
                : "Done"}
            </span>
          </div>
          <button
            onClick={() => setCardExpanded(true)}
            className="shrink-0 text-zinc-300 hover:text-zinc-500 leading-none transition-colors"
            aria-label="Show details"
          >
            ↓
          </button>
        </div>
        {session.notes && (
          <p className="text-xs text-zinc-500 line-clamp-1">{session.notes}</p>
        )}
        {compactExecLine && (
          <p className="text-xs text-zinc-600">{compactExecLine}</p>
        )}
        {coachTakeaway && !isResolved && (
          <p className="text-xs text-zinc-500 italic line-clamp-2">{coachTakeaway}</p>
        )}
        {hasBadges && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 pt-0.5">
            {(session.stravaLinks?.length ?? 0) > 0 && (
              <span className="text-[10px] font-medium text-orange-500">Strava ✓</span>
            )}
            {isInjury && !isResolved && (
              <span className="text-[10px] font-semibold text-red-500">Issue open</span>
            )}
            {isInjury && isResolved && (
              <span className="text-[10px] text-zinc-400">Issue resolved</span>
            )}
          </div>
        )}
      </motion.div>
    );
  }

  return (
    <div className={`space-y-2 rounded-2xl bg-white border border-zinc-100 border-l-[3px] ${intensityBorder} shadow-card hover:shadow-card-hover transition-shadow duration-200 p-4`}>
      {/* ── Session header ── */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-zinc-800">{formatIntensity(session.intensity)}</span>
          <span className="text-xs text-zinc-400">
            {session.durationMin} min · {formatSlot(session.preferredSlot)}
          </span>
          {session.planningType === "fixed" && (
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500">fixed</span>
          )}
          {session.planningType === "preferred" && (
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-500">optional</span>
          )}
          {session.planningType === "manual" && (
            <span className="rounded-full bg-purple-50 px-2 py-0.5 text-[10px] font-medium text-purple-500">manual</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {done ? (
            <>
              <span className={`text-sm font-medium ${isResolved ? "text-zinc-400" : "text-emerald-600"}`}>
                {isResolved
                  ? "Done · resolved"
                  : checkIn
                  ? `Done · ${checkIn.feelScore}/6`
                  : "Done"}
              </span>
              {!editing && (
                <button onClick={startEdit} className="text-xs text-zinc-400 underline hover:text-zinc-600 transition-colors">
                  edit
                </button>
              )}
            </>
          ) : isSkipped ? (
            <span className="text-xs text-zinc-400">Skipped</span>
          ) : isFuture ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400">Upcoming</span>
              <button
                onClick={handleSkip}
                disabled={skipPending}
                className="text-xs text-zinc-400 hover:text-zinc-600 transition-colors disabled:opacity-40"
              >
                {skipPending ? "…" : "Skip"}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setEditing(false);
                  setOpen(true);
                }}
                className="text-sm font-medium text-indigo-600 hover:text-indigo-700 transition-colors"
              >
                Check in
              </button>
              <span className="text-zinc-200 select-none">·</span>
              <button
                onClick={handleSkip}
                disabled={skipPending}
                className="text-xs text-zinc-400 hover:text-zinc-600 transition-colors disabled:opacity-40"
              >
                {skipPending ? "…" : "Skip"}
              </button>
            </div>
          )}
          {shouldCollapse && (
            <button
              onClick={() => setCardExpanded(false)}
              className="text-zinc-300 hover:text-zinc-500 leading-none transition-colors"
              aria-label="Collapse"
            >
              ↑
            </button>
          )}
        </div>
      </div>

      {/* Notes shown here for done/upcoming; skipped branch renders its own to avoid duplication */}
      {session.notes && !isSkipped && (
        <p className="text-sm text-zinc-600">{session.notes}</p>
      )}

      {done ? (
        // ════════════════════════════════════════
        // DONE SESSION — execution-first layout
        // ════════════════════════════════════════
        <>
          {/* Compact metric pills — visible at a glance for done+strava sessions */}
          {(session.stravaLinks?.length ?? 0) > 0 && (
            <CompactMetricPills links={session.stravaLinks!} />
          )}

          {/* Check-in note + coach advice (not editing) */}
          {!open && checkIn && (
            <div className="space-y-1">
              {checkIn.notes && (
                <p className="text-xs text-zinc-500 italic">&ldquo;{checkIn.notes}&rdquo;</p>
              )}
              {coachAdvice && !isResolved && (
                <div className={`rounded-xl px-3 py-2 ${isPositiveAdvice ? "bg-emerald-50 border border-emerald-100" : "bg-amber-50 border border-amber-100"}`}>
                  <p className={`text-[10px] font-semibold uppercase tracking-widest mb-0.5 ${isPositiveAdvice ? "text-emerald-600" : "text-amber-600"}`}>Coach</p>
                  <p className={`text-xs whitespace-pre-line ${isPositiveAdvice ? "text-emerald-800" : "text-amber-800"}`}>{stripMarkdownBold(coachAdvice)}</p>
                </div>
              )}
              {hint && (
                <p className="text-xs text-amber-600">{hint}</p>
              )}
            </div>
          )}

          {/* Execution summary — actual vs plan */}
          {(session.stravaLinks?.length ?? 0) > 0 && (
            <ExecutionSummaryBlock
              session={{ durationMin: session.durationMin, notes: session.notes }}
              stravaLinks={session.stravaLinks!}
            />
          )}

          {/* HR Analytics — auto-shown when stream exists */}
          {session.hrAnalytics ? (
            <div className="border-t pt-2">
              <SessionAnalytics analytics={session.hrAnalytics} />
            </div>
          ) : (session.stravaLinks?.length ?? 0) > 0 && primaryActivityId ? (
            <div className="border-t pt-2">
              <AnalyzeStreamButton activityId={primaryActivityId} sessionId={session.id} />
            </div>
          ) : null}

          {/* After-workout coach feedback */}
          {feedbackGenerating ? (
            <div className="border-t pt-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">After workout</p>
              <p className="text-xs text-zinc-400 mt-1">Analyzing workout…</p>
            </div>
          ) : (
            <WorkoutFeedbackSection
              key={`feedback-${session.id}-${session.workoutFeedback?.generatedAt ?? "none"}`}
              sessionId={session.id}
              initialFeedback={session.workoutFeedback ?? null}
              sessionIsDone={done}
              hasCheckIn={!!checkIn}
            />
          )}

          {/* Action buttons — flex-wrap to avoid overlap */}
          {!editing && checkIn && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5">
              {(session.stravaLinks?.length ?? 0) > 0 && (
                <button
                  onClick={reanalyzeAdvice}
                  disabled={submitting}
                  className="text-[10px] text-zinc-400 underline disabled:opacity-50"
                >
                  {submitting ? "Re-analyzing…" : "Re-analyze"}
                </button>
              )}
              {isInjury && !isResolved && (
                <button
                  onClick={resolveIssue}
                  disabled={submitting}
                  className="text-xs text-emerald-600 underline disabled:opacity-50"
                >
                  Mark issue resolved
                </button>
              )}
              {isInjury && isResolved && (
                <button
                  onClick={reopenIssue}
                  disabled={submitting}
                  className="text-xs text-zinc-400 underline disabled:opacity-50"
                >
                  Reopen issue
                </button>
              )}
            </div>
          )}

          {/* Strava panel — attach/manage activities */}
          {session.stravaConnected && (
            <StravaPanel
              sessionId={session.id}
              sessionDate={session.scheduledDate}
              sessionDurationMin={session.durationMin}
              sessionNotes={session.notes}
              sessionSlot={session.preferredSlot}
              initialLinks={session.stravaLinks ?? []}
              stravaConnected={session.stravaConnected}
              onActivityAttached={handleActivityAttached}
            />
          )}

          {/* Workout plan — collapsed at bottom for done sessions */}
          {workoutPlan && (
            <div className="border-t pt-2">
              <button
                onClick={() => setShowWorkoutPlan((v) => !v)}
                className="text-[10px] text-zinc-400 underline hover:text-zinc-600 transition-colors"
              >
                {showWorkoutPlan ? "Hide pre-workout plan" : "Pre-workout plan"}
              </button>
              {showWorkoutPlan && (
                <WorkoutPlanBlock
                  plan={workoutPlan}
                  sessionId={session.id}
                  onRegenerate={generatePlan}
                  regenerating={planGenerating}
                  nutritionAdvice={null}
                />
              )}
            </div>
          )}
        </>
      ) : isSkipped ? (
        // ════════════════════════════════════════
        // SKIPPED SESSION — minimal body
        // ════════════════════════════════════════
        <div className="border-t border-zinc-100 pt-2.5 space-y-1.5">
          {session.notes && (
            <p className="text-sm text-zinc-500">{session.notes}</p>
          )}
          <p className="text-xs text-zinc-400">Skipped — not completed</p>
        </div>
      ) : (
        // ════════════════════════════════════════
        // UPCOMING / PLANNED SESSION — plan-first layout
        // ════════════════════════════════════════
        <>
          {/* Workout plan or generate button */}
          {workoutPlan ? (
            <WorkoutPlanBlock
              plan={workoutPlan}
              sessionId={session.id}
              onRegenerate={generatePlan}
              regenerating={planGenerating}
              nutritionAdvice={nutritionAdvice}
            />
          ) : (
            <div className="border-t border-zinc-100 pt-2.5">
              <button
                onClick={generatePlan}
                disabled={planGenerating}
                className="text-xs text-indigo-500 underline disabled:opacity-40 hover:text-indigo-700 transition-colors"
              >
                {planGenerating ? "Generating plan…" : "Plan workout"}
              </button>
            </div>
          )}

          {/* Strava attach area for upcoming sessions */}
          {session.stravaConnected && (
            <StravaPanel
              sessionId={session.id}
              sessionDate={session.scheduledDate}
              sessionDurationMin={session.durationMin}
              sessionNotes={session.notes}
              sessionSlot={session.preferredSlot}
              initialLinks={session.stravaLinks ?? []}
              stravaConnected={session.stravaConnected}
            />
          )}
        </>
      )}

      {/* Check-in / edit form */}
      {open && (
        <div className="space-y-2.5 border-t border-zinc-100 pt-3">
          <p className="text-xs text-zinc-400">How did it feel? (1 = terrible, 6 = great)</p>
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <button
                key={n}
                onClick={() => setFeelScore(n)}
                className={`h-9 w-9 rounded-xl border text-sm font-medium transition-colors ${
                  feelScore === n
                    ? "bg-zinc-900 text-white border-zinc-900"
                    : "border-zinc-200 text-zinc-600 hover:border-zinc-400"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <input
            type="text"
            placeholder="Notes (optional — mention injuries if any)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-800 placeholder-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-300"
          />
          <div className="flex gap-2">
            <button
              onClick={editing ? updateCheckIn : submitCheckIn}
              disabled={submitting}
              className="flex-1 rounded-xl bg-zinc-900 py-2 text-sm font-medium text-white disabled:opacity-50 hover:bg-zinc-800 transition-colors"
            >
              {submitting ? "Saving…" : editing ? "Update" : "Save"}
            </button>
            <button
              onClick={() => {
                setOpen(false);
                setEditing(false);
              }}
              className="rounded-xl border border-zinc-200 px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
