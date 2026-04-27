"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { normalizeCoachBullets } from "@/lib/format-bullets";

const PRIORITY_OPTIONS = [
  "More HYROX this week",
  "Focus on running volume",
  "Easy recovery week",
  "Long ride priority",
  "Marathon pace work",
  "Balanced",
];

const DRAFT_KEY = "review_draft_v2";

const DOW_LABELS: Record<number, string> = {
  0: "Sun", 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat",
};

const WEEK_DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type DraftState = {
  recoveryScore: number | null;
  selectedPriorities: string[];
  familyConstraints: string;
  trainingPreferencesText: string;
};

type ExistingDraft = {
  planId: string;
  weekStart: string;
  focusSummary: string | null;
  sessions: Array<{
    scheduledDate: string;
    durationMin: number;
    intensity: string;
    notes: string | null;
    preferredSlot: string;
  }>;
} | null;

type SessionExecution = {
  actualMovingMin: number;
  actualDistanceKm: number | null;
  elevationGain: number | null;
  paceStr: string | null;
  qualityLabel: string;
  splitSession: boolean;
  hillsIndicator: boolean;
  actualSportTypes?: string[];
};

type SessionSummary = {
  id: string;
  date: string;
  intensity: string;
  durationMin: number;
  notes: string | null;
  status: string;
  checkIn: { feelScore: number; notes: string | null } | null;
  execution: SessionExecution | null;
};

type WeeklyStats = {
  weekStart: string;
  weekEnd: string;
  planned: number;
  done: number;
  skipped: number;
  plannedDurationMin: number;
  actualMovingMin: number | null;
  plannedRunningKm: number | null;
  actualRunningKm: number | null;
  hardPlanned: number;
  hardDone: number;
  adherenceByCount: number;
  adherenceByDuration: number | null;
  executionQuality: {
    matched: number;
    slightlyShort: number;
    clearlyShort: number;
    longerThanPlanned: number;
    interrupted: number;
    hillyVariant: number;
    splitSessions: number;
  };
  signals: {
    lowReadinessDays: number;
    fatigueDays: number;
    injuryDays: number;
    unresolvedIssues: number;
    mainLimiter: string | null;
  };
  sessions: SessionSummary[];
  carryForward: string[];
};

type ArchiveSession = {
  id: string;
  date: string;
  intensity: string;
  durationMin: number;
  notes: string | null;
  status: string;
  checkIn: { feelScore: number } | null;
  execution: {
    actualMovingMin: number;
    actualDistanceKm: number | null;
    paceStr: string | null;
    qualityLabel: string;
    actualSportTypes: string[];
  } | null;
};

type ArchivePlan = {
  planId: string;
  weekStart: string;
  weekEnd: string;
  focusSummary: string | null;
  planned: number;
  done: number;
  skipped: number;
  sessions: ArchiveSession[];
} | null;

function loadDraft(): DraftState {
  if (typeof window === "undefined")
    return { recoveryScore: null, selectedPriorities: [], familyConstraints: "", trainingPreferencesText: "" };
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return { recoveryScore: null, selectedPriorities: [], familyConstraints: "", trainingPreferencesText: "" };
    const parsed = JSON.parse(raw) as Partial<DraftState>;
    return {
      recoveryScore: parsed.recoveryScore ?? null,
      selectedPriorities: parsed.selectedPriorities ?? [],
      familyConstraints: parsed.familyConstraints ?? "",
      trainingPreferencesText: parsed.trainingPreferencesText ?? "",
    };
  } catch {
    return { recoveryScore: null, selectedPriorities: [], familyConstraints: "", trainingPreferencesText: "" };
  }
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

function shortDay(dateStr: string): string {
  const d = new Date(dateStr + (dateStr.includes("T") ? "" : "T12:00:00Z"));
  return DOW_LABELS[d.getUTCDay()];
}

function fmtMin(min: number): string {
  if (min >= 60) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${min}m`;
}

function normalizeSportType(st: string): string {
  const l = st.toLowerCase();
  if (l.includes("run")) return "Running";
  if (l.includes("ride") || l.includes("cycling") || l.includes("cycle") || l.includes("bike")) return "Cycling";
  if (l.includes("swim")) return "Swimming";
  if (l.includes("weight") || l.includes("crossfit") || l.includes("hyrox")) return "Strength";
  return st;
}

export default function ReviewPage() {
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);
  const [recoveryScore, setRecoveryScore] = useState<number | null>(null);
  const [selectedPriorities, setSelectedPriorities] = useState<string[]>([]);
  const [familyConstraints, setFamilyConstraints] = useState("");
  const [trainingPreferencesText, setTrainingPreferencesText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [existingDraft, setExistingDraft] = useState<ExistingDraft | undefined>(undefined);
  const [weeklyStats, setWeeklyStats] = useState<WeeklyStats | null | undefined>(undefined);
  const [archivePlan, setArchivePlan] = useState<ArchivePlan | undefined>(undefined);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [sessionDetailOpen, setSessionDetailOpen] = useState(false);

  useEffect(() => {
    const draft = loadDraft();
    setRecoveryScore(draft.recoveryScore);
    setSelectedPriorities(draft.selectedPriorities);
    setFamilyConstraints(draft.familyConstraints);
    setTrainingPreferencesText(draft.trainingPreferencesText);
    setHydrated(true);
  }, []);

  useEffect(() => {
    fetch("/api/plans/review")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setExistingDraft(data as ExistingDraft))
      .catch(() => setExistingDraft(null));
  }, []);

  useEffect(() => {
    fetch("/api/plans/review/stats")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setWeeklyStats(data as WeeklyStats | null))
      .catch(() => setWeeklyStats(null));
  }, []);

  useEffect(() => {
    fetch("/api/plans/archive/latest")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setArchivePlan(data as ArchivePlan | null))
      .catch(() => setArchivePlan(null));
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const draft: DraftState = { recoveryScore, selectedPriorities, familyConstraints, trainingPreferencesText };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  }, [recoveryScore, selectedPriorities, familyConstraints, trainingPreferencesText, hydrated]);

  function togglePriority(opt: string) {
    setSelectedPriorities((prev) =>
      prev.includes(opt) ? prev.filter((p) => p !== opt) : [...prev, opt]
    );
  }

  async function submit() {
    setSubmitting(true);
    setError(null);

    const weeklyReview = {
      ...(recoveryScore !== null && { recoveryScore }),
      ...(selectedPriorities.length > 0 && { priorities: selectedPriorities }),
      ...(familyConstraints.trim() && { familyConstraints: familyConstraints.trim() }),
      ...(trainingPreferencesText.trim() && { trainingPreferencesText: trainingPreferencesText.trim() }),
    };

    try {
      const res = await fetch("/api/plans/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weeklyReview }),
      });
      if (!res.ok) throw new Error("Failed to generate plan");

      localStorage.removeItem(DRAFT_KEY);
      setSuccess(true);
      setTimeout(() => router.push("/week"), 1800);
    } catch {
      setError("Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <main className="p-4 flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <p className="text-2xl">✓</p>
        <p className="text-base font-medium">Next week is planned</p>
        <p className="text-sm text-gray-500 text-center">
          Your current week is unchanged. The new plan activates on Monday.
        </p>
      </main>
    );
  }

  const hasDraft = existingDraft != null;
  const weekStartLabel =
    hasDraft && existingDraft
      ? formatDate(
          typeof existingDraft.weekStart === "string"
            ? existingDraft.weekStart
            : new Date(existingDraft.weekStart).toISOString()
        )
      : null;

  return (
    <main className="p-4 space-y-6">
      <div>
        <h1 className="text-xl font-bold">Review &amp; Plan</h1>
      </div>

      {/* ── This week ────────────────────────────── */}
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">This week</p>
        {weeklyStats === undefined ? (
          <p className="text-xs text-gray-400">Loading week summary…</p>
        ) : weeklyStats !== null ? (
          <div className="space-y-4">
            <StatsBlock stats={weeklyStats} />
            <ExecQualityBlock eq={weeklyStats.executionQuality} />
            <SignalsBlock signals={weeklyStats.signals} />
            <div>
              <button
                onClick={() => setSessionDetailOpen((v) => !v)}
                className="text-xs text-gray-400 underline"
              >
                {sessionDetailOpen ? "Hide session details" : "Show session details"}
              </button>
              {sessionDetailOpen && <div className="mt-2"><SessionDayList stats={weeklyStats} /></div>}
            </div>
          </div>
        ) : null}
      </div>

      {/* ── Carry into next week ─────────────────── */}
      {weeklyStats && weeklyStats.carryForward.length > 0 && (
        <CarryForwardBlock bullets={weeklyStats.carryForward} />
      )}

      {/* ── Previous week (archive) ──────────────── */}
      {archivePlan && (
        <PreviousWeekBlock plan={archivePlan} open={archiveOpen} onToggle={() => setArchiveOpen((v) => !v)} />
      )}

      {/* ── Plan next week ───────────────────────── */}
      <div className="border-t pt-4 space-y-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Plan next week</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Generates a draft for next week only. Your current week is not affected.
          </p>
        </div>

        {hasDraft && existingDraft && (
          <div className="rounded border border-blue-200 bg-blue-50 px-3 py-3 space-y-2">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-blue-900">Next week already planned</p>
                {weekStartLabel && (
                  <p className="text-xs text-blue-600 mt-0.5">Starts {weekStartLabel}</p>
                )}
              </div>
              <span className="text-xs text-blue-400 font-mono">draft</span>
            </div>
            {existingDraft.focusSummary && (
              <div className="space-y-1">
                {normalizeCoachBullets(existingDraft.focusSummary)
                  .split("\n\n")
                  .filter((l) => l.trim())
                  .map((line, i) => (
                    <p key={i} className="text-xs text-blue-800">{line}</p>
                  ))}
              </div>
            )}
            {existingDraft.sessions.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {existingDraft.sessions.map((s, i) => (
                  <span
                    key={i}
                    className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700"
                  >
                    {shortDay(
                      typeof s.scheduledDate === "string"
                        ? s.scheduledDate
                        : new Date(s.scheduledDate).toISOString().split("T")[0]
                    )}{" "}
                    · {s.intensity} · {s.notes?.split(":")[0] ?? "session"}
                  </span>
                ))}
              </div>
            )}
            <p className="text-xs text-blue-500">
              Customize below and click &quot;Update plan&quot; to regenerate.
            </p>
          </div>
        )}

        <section className="space-y-2">
          <h2 className="font-semibold text-sm">How are you feeling going into next week?</h2>
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <button
                key={n}
                onClick={() => setRecoveryScore(recoveryScore === n ? null : n)}
                className={`h-10 w-10 rounded border text-sm font-medium ${
                  recoveryScore === n ? "bg-black text-white border-black" : "border-gray-300"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-400">1 = very fatigued / injured · 6 = fresh and ready</p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-sm">
            What do you want to prioritize next week?
            {selectedPriorities.length > 0 && (
              <span className="ml-2 text-xs font-normal text-gray-400">
                {selectedPriorities.length} selected
              </span>
            )}
          </h2>
          <div className="flex flex-wrap gap-2">
            {PRIORITY_OPTIONS.map((opt) => (
              <button
                key={opt}
                onClick={() => togglePriority(opt)}
                className={`rounded border px-3 py-1 text-xs ${
                  selectedPriorities.includes(opt)
                    ? "bg-black text-white border-black"
                    : "border-gray-300"
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-sm">Training preferences</h2>
          <textarea
            value={trainingPreferencesText}
            onChange={(e) => setTrainingPreferencesText(e.target.value)}
            placeholder="e.g. Marathon is close, but if weather is good I'd like one easy bike ride."
            rows={2}
            className="w-full rounded border px-3 py-2 text-sm"
          />
          <p className="text-xs text-gray-400">Soft guidance — Claude will weigh this alongside recovery and schedule.</p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-sm">Partner / family constraints next week</h2>
          <textarea
            value={familyConstraints}
            onChange={(e) => setFamilyConstraints(e.target.value)}
            placeholder="e.g. Saturday afternoon is family time, Sunday morning free until 11"
            rows={3}
            className="w-full rounded border px-3 py-2 text-sm"
          />
        </section>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <button
          onClick={submit}
          disabled={submitting}
          className="w-full rounded bg-black py-3 text-sm font-medium text-white disabled:opacity-50"
        >
          {submitting
            ? "Generating next week's plan..."
            : hasDraft
            ? "Update next week's plan"
            : "Generate next week's plan"}
        </button>

        <button
          onClick={() => router.back()}
          className="w-full rounded border py-2 text-sm text-gray-500"
        >
          Cancel
        </button>
      </div>
    </main>
  );
}

// ── Review sub-components ─────────────────────────────────────────────────────

function StatsBlock({ stats }: { stats: WeeklyStats }) {
  return (
    <div className="rounded border border-gray-200 bg-gray-50 px-3 py-3 space-y-2">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
        {stats.weekStart}
      </p>
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <span className="text-xs text-gray-400">Sessions</span>
        <span className="text-xs text-gray-700">
          {stats.planned} planned · {stats.done} done
          {stats.skipped > 0 ? ` · ${stats.skipped} skipped` : ""}
        </span>

        <span className="text-xs text-gray-400">Duration</span>
        <span className="text-xs text-gray-700">
          {stats.plannedDurationMin}min planned
          {stats.actualMovingMin != null ? ` · ${stats.actualMovingMin}min actual` : ""}
        </span>

        {(stats.plannedRunningKm != null || stats.actualRunningKm != null) && (
          <>
            <span className="text-xs text-gray-400">Running</span>
            <span className="text-xs text-gray-700">
              {stats.plannedRunningKm != null ? `${stats.plannedRunningKm}km planned` : ""}
              {stats.actualRunningKm != null
                ? `${stats.plannedRunningKm != null ? " · " : ""}${stats.actualRunningKm}km actual`
                : ""}
            </span>
          </>
        )}

        <span className="text-xs text-gray-400">Hard</span>
        <span className="text-xs text-gray-700">
          {stats.hardPlanned} planned · {stats.hardDone} done
        </span>

        <span className="text-xs text-gray-400">Adherence</span>
        <span className="text-xs text-gray-700">
          {stats.adherenceByCount}% sessions
          {stats.adherenceByDuration != null ? ` · ${stats.adherenceByDuration}% duration` : ""}
        </span>
      </div>
    </div>
  );
}

function ExecQualityBlock({ eq }: { eq: WeeklyStats["executionQuality"] }) {
  const items = [
    { label: "Matched", count: eq.matched },
    { label: "Slightly short", count: eq.slightlyShort },
    { label: "Clearly short", count: eq.clearlyShort },
    { label: "Longer", count: eq.longerThanPlanned },
    { label: "Interrupted", count: eq.interrupted },
    { label: "Hilly variant", count: eq.hillyVariant },
  ].filter((item) => item.count > 0);

  if (items.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Execution quality</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <span
            key={item.label}
            className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
          >
            {item.label}: {item.count}
          </span>
        ))}
        {eq.splitSessions > 0 && (
          <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
            Split: {eq.splitSessions}
          </span>
        )}
      </div>
    </div>
  );
}

function SignalsBlock({ signals }: { signals: WeeklyStats["signals"] }) {
  const hasAny =
    signals.lowReadinessDays > 0 ||
    signals.fatigueDays > 0 ||
    signals.injuryDays > 0 ||
    signals.unresolvedIssues > 0;
  if (!hasAny) return null;

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Signals this week</p>
      <div className="space-y-0.5">
        {signals.lowReadinessDays > 0 && (
          <p className="text-xs text-gray-600">
            Low readiness: {signals.lowReadinessDays} day{signals.lowReadinessDays > 1 ? "s" : ""}
          </p>
        )}
        {signals.fatigueDays > 0 && (
          <p className="text-xs text-gray-600">
            Fatigue: {signals.fatigueDays} check-in{signals.fatigueDays > 1 ? "s" : ""}
          </p>
        )}
        {signals.injuryDays > 0 && (
          <p className="text-xs text-orange-700">
            Injury: {signals.injuryDays} check-in{signals.injuryDays > 1 ? "s" : ""}
          </p>
        )}
        {signals.unresolvedIssues > 0 && (
          <p className="text-xs font-medium text-red-600">
            Unresolved issues: {signals.unresolvedIssues}
          </p>
        )}
        {signals.mainLimiter && (
          <p className="text-xs italic text-gray-500">Main limiter: {signals.mainLimiter}</p>
        )}
      </div>
    </div>
  );
}

function SessionDayList({ stats }: { stats: WeeklyStats }) {
  const weekDays: string[] = [];
  const start = new Date(stats.weekStart + "T00:00:00Z");
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    weekDays.push(d.toISOString().split("T")[0]);
  }

  const sessionsByDate = new Map<string, SessionSummary[]>();
  for (const s of stats.sessions) {
    if (!sessionsByDate.has(s.date)) sessionsByDate.set(s.date, []);
    sessionsByDate.get(s.date)!.push(s);
  }

  const hasSessions = stats.sessions.length > 0;
  if (!hasSessions) return null;

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Sessions</p>
      <div className="space-y-1.5">
        {weekDays.map((dateStr, i) => {
          const daySessions = sessionsByDate.get(dateStr) ?? [];
          const dayLabel = WEEK_DOW[i];
          const dayNum = dateStr.slice(8);

          if (daySessions.length === 0) {
            return (
              <div key={dateStr} className="flex items-baseline gap-2">
                <span className="text-xs text-gray-400 w-14 shrink-0">{dayLabel} {dayNum}</span>
                <span className="text-xs text-gray-300">Rest</span>
              </div>
            );
          }

          return (
            <div key={dateStr} className="space-y-1">
              <span className="text-xs text-gray-400">{dayLabel} {dayNum}</span>
              {daySessions.map((s) => (
                <SessionRow key={s.id} session={s} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SessionRow({ session: s }: { session: SessionSummary }) {
  const noteLabel = s.notes ? s.notes.split(":")[0].trim() : null;
  const isDone = s.status === "done";
  const isSkipped = s.status === "skipped";

  const actualSportLabel = s.execution?.actualSportTypes?.length
    ? [...new Set(s.execution.actualSportTypes.map(normalizeSportType))].join(" + ")
    : null;

  const actualLine = s.execution
    ? [
        actualSportLabel,
        fmtMin(s.execution.actualMovingMin),
        s.execution.actualDistanceKm != null ? `${s.execution.actualDistanceKm}km` : null,
        s.execution.paceStr,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  return (
    <div className="rounded bg-gray-50 px-2.5 py-1.5 space-y-0.5">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span
          className={`text-xs font-medium ${
            isDone ? "text-green-600" : isSkipped ? "text-gray-400" : "text-gray-400"
          }`}
        >
          {isDone ? "✓" : isSkipped ? "—" : "·"}
        </span>
        <span className="text-xs font-medium text-gray-700">
          {s.intensity} · {s.durationMin}min
        </span>
        {noteLabel && (
          <span className="text-xs text-gray-500">{noteLabel}</span>
        )}
        {isSkipped && <span className="text-xs text-gray-400">(skipped)</span>}
        {!isDone && !isSkipped && <span className="text-xs text-gray-400">(planned)</span>}
      </div>

      {isDone && actualLine && (
        <div className="flex items-baseline gap-1 flex-wrap">
          <span className="text-[10px] text-gray-400">Actual</span>
          <span className="text-xs text-gray-600">{actualLine}</span>
          <span className="text-[10px] text-gray-400">{s.execution!.qualityLabel}</span>
        </div>
      )}

      {isDone && s.checkIn && (
        <p className="text-[10px] text-gray-400">feel {s.checkIn.feelScore}/6</p>
      )}
    </div>
  );
}

function CarryForwardBlock({ bullets }: { bullets: string[] }) {
  if (bullets.length === 0) return null;

  return (
    <div className="rounded border border-gray-200 bg-gray-50 px-3 py-3 space-y-1.5">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
        Carry into next week
      </p>
      <ul className="space-y-1">
        {bullets.map((b, i) => (
          <li key={i} className="text-xs text-gray-700">
            • {b}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PreviousWeekBlock({
  plan,
  open,
  onToggle,
}: {
  plan: ArchivePlan;
  open: boolean;
  onToggle: () => void;
}) {
  if (!plan) return null;

  return (
    <div className="rounded border border-gray-200 px-3 py-2.5">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between text-left"
      >
        <span className="text-xs font-semibold text-gray-500">
          Previous week · {plan.weekStart}
        </span>
        <span className="text-xs text-gray-400">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-gray-500">
            {plan.planned} sessions · {plan.done} done
            {plan.skipped > 0 ? ` · ${plan.skipped} skipped` : ""}
          </p>
          {plan.focusSummary && (
            <div className="space-y-0.5">
              {normalizeCoachBullets(plan.focusSummary)
                .split("\n\n")
                .filter((l) => l.trim())
                .map((line, i) => (
                  <p key={i} className="text-xs text-gray-400">{line}</p>
                ))}
            </div>
          )}
          <div className="space-y-1">
            {plan.sessions.map((s) => {
              const noteLabel = s.notes ? s.notes.split(":")[0].trim() : null;
              const isDone = s.status === "done";
              const isSkipped = s.status === "skipped";
              const actualSportLabel = s.execution?.actualSportTypes?.length
                ? [...new Set(s.execution.actualSportTypes.map(normalizeSportType))].join(" + ")
                : null;
              const actualLine = s.execution
                ? [
                    actualSportLabel,
                    fmtMin(s.execution.actualMovingMin),
                    s.execution.actualDistanceKm != null ? `${s.execution.actualDistanceKm}km` : null,
                    s.execution.paceStr,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : null;

              return (
                <div key={s.id} className="rounded bg-gray-50 px-2 py-1 space-y-0.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`text-[10px] ${isDone ? "text-green-600" : isSkipped ? "text-gray-400" : "text-gray-400"}`}>
                      {isDone ? "✓" : isSkipped ? "—" : "·"}
                    </span>
                    <span className="text-[11px] text-gray-500">
                      {s.date.slice(5)} · {s.intensity} · {s.durationMin}min
                      {noteLabel ? ` · ${noteLabel}` : ""}
                    </span>
                  </div>
                  {isDone && actualLine && (
                    <p className="text-[10px] text-gray-400">
                      Actual: {actualLine}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
