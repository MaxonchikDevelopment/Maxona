"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { normalizeCoachBullets } from "@/lib/format-bullets";
import { formatIntensity } from "@/lib/format-labels";
import { PageWrapper, StaggerList, StaggerItem } from "@/components/ui/page-wrapper";

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
  fatigue: number | null;
  soreness: number | null;
  motivation: number | null;
  sorenessAreas: string[];
};

const SORENESS_AREAS = ["Calves", "Knees", "Hips", "Shoulders", "Back", "Quads"];

type FixedSessionRow = {
  id: string;
  scheduledDate: string;
  preferredSlot: string;
  durationMin: number;
  intensity: string;
  modality: string;
  notes: string | null;
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

const EMPTY_DRAFT: DraftState = {
  recoveryScore: null,
  selectedPriorities: [],
  familyConstraints: "",
  trainingPreferencesText: "",
  fatigue: null,
  soreness: null,
  motivation: null,
  sorenessAreas: [],
};

function loadDraft(): DraftState {
  if (typeof window === "undefined") return EMPTY_DRAFT;
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return EMPTY_DRAFT;
    const parsed = JSON.parse(raw) as Partial<DraftState>;
    return {
      recoveryScore: parsed.recoveryScore ?? null,
      selectedPriorities: parsed.selectedPriorities ?? [],
      familyConstraints: parsed.familyConstraints ?? "",
      trainingPreferencesText: parsed.trainingPreferencesText ?? "",
      fatigue: parsed.fatigue ?? null,
      soreness: parsed.soreness ?? null,
      motivation: parsed.motivation ?? null,
      sorenessAreas: parsed.sorenessAreas ?? [],
    };
  } catch {
    return EMPTY_DRAFT;
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
  const [fatigue, setFatigue] = useState<number | null>(null);
  const [soreness, setSoreness] = useState<number | null>(null);
  const [motivation, setMotivation] = useState<number | null>(null);
  const [sorenessAreas, setSorenessAreas] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [existingDraft, setExistingDraft] = useState<ExistingDraft | undefined>(undefined);
  const [weeklyStats, setWeeklyStats] = useState<WeeklyStats | null | undefined>(undefined);
  const [archivePlan, setArchivePlan] = useState<ArchivePlan | undefined>(undefined);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [sessionDetailOpen, setSessionDetailOpen] = useState(false);
  const [fixedSessions, setFixedSessions] = useState<FixedSessionRow[]>([]);

  useEffect(() => {
    const draft = loadDraft();
    setRecoveryScore(draft.recoveryScore);
    setSelectedPriorities(draft.selectedPriorities);
    setFamilyConstraints(draft.familyConstraints);
    setTrainingPreferencesText(draft.trainingPreferencesText);
    setFatigue(draft.fatigue);
    setSoreness(draft.soreness);
    setMotivation(draft.motivation);
    setSorenessAreas(draft.sorenessAreas);
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
    fetch("/api/plans/fixed-sessions")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setFixedSessions((data?.sessions as FixedSessionRow[]) ?? []))
      .catch(() => setFixedSessions([]));
  }, []);

  async function addFixedSession(input: {
    dayOffset: number;
    preferredSlot: string;
    durationMin: number;
    intensity: string;
    modality: string;
    notes: string;
  }) {
    const res = await fetch("/api/plans/fixed-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (res.ok) {
      const row = (await res.json()) as FixedSessionRow;
      setFixedSessions((prev) =>
        [...prev, row].sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate))
      );
    }
  }

  async function removeFixedSession(id: string) {
    setFixedSessions((prev) => prev.filter((s) => s.id !== id));
    await fetch(`/api/plans/fixed-sessions?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  useEffect(() => {
    if (!hydrated) return;
    const draft: DraftState = {
      recoveryScore, selectedPriorities, familyConstraints, trainingPreferencesText,
      fatigue, soreness, motivation, sorenessAreas,
    };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  }, [recoveryScore, selectedPriorities, familyConstraints, trainingPreferencesText, fatigue, soreness, motivation, sorenessAreas, hydrated]);

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
      ...(fatigue !== null && { fatigue }),
      ...(soreness !== null && { soreness }),
      ...(motivation !== null && { motivation }),
      ...(soreness !== null && soreness >= 3 && sorenessAreas.length > 0 && { sorenessAreas }),
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
      <main className="flex flex-col items-center justify-center min-h-[60vh] gap-3 px-4">
        <div className="w-12 h-12 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center">
          <span className="text-emerald-600 text-lg font-bold">✓</span>
        </div>
        <p className="text-base font-semibold text-zinc-800">Next week is planned</p>
        <p className="text-sm text-zinc-500 text-center">
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

  const inputCls =
    "w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-800 placeholder-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-300";

  // ── Action card (shared between mobile top + desktop side rail) ──────────────
  const ActionCard = (
    <div className="rounded-2xl bg-white border border-zinc-100 shadow-card p-4 space-y-4">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-0.5">
          {hasDraft ? "Update plan" : "Generate plan"}
        </p>
        <p className="text-xs text-zinc-500">
          {hasDraft
            ? "Customize below and regenerate next week."
            : "Generates a draft for next week only. Current week is not affected."}
        </p>
      </div>

      {hasDraft && existingDraft && (
        <div className="rounded-xl bg-indigo-50 border border-indigo-100 px-3 py-2.5 space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-indigo-800">Next week already planned</p>
            <span className="text-[10px] font-mono text-indigo-400">draft</span>
          </div>
          {weekStartLabel && (
            <p className="text-xs text-indigo-600">Starts {weekStartLabel}</p>
          )}
          {existingDraft.focusSummary && (
            <div className="space-y-0.5">
              {normalizeCoachBullets(existingDraft.focusSummary)
                .split("\n\n")
                .filter((l) => l.trim())
                .map((line, i) => (
                  <p key={i} className="text-xs text-indigo-700 leading-relaxed">{line.replace(/^[•·]\s*/, "")}</p>
                ))}
            </div>
          )}
          {existingDraft.sessions.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {existingDraft.sessions.map((s, i) => (
                <span
                  key={i}
                  className="rounded-full bg-indigo-100 border border-indigo-200 px-2 py-0.5 text-[10px] font-medium text-indigo-700"
                >
                  {shortDay(
                    typeof s.scheduledDate === "string"
                      ? s.scheduledDate
                      : new Date(s.scheduledDate).toISOString().split("T")[0]
                  )}{" "}
                  · <span className="capitalize">{s.intensity}</span> · {s.notes?.split(":")[0] ?? "session"}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Recovery score */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-zinc-700">Going into next week — how do you feel?</p>
        <div className="flex gap-1.5">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <button
              key={n}
              onClick={() => setRecoveryScore(recoveryScore === n ? null : n)}
              className={`h-9 w-9 rounded-xl border text-sm font-medium transition-colors ${
                recoveryScore === n
                  ? "bg-zinc-900 text-white border-zinc-900"
                  : "border-zinc-200 text-zinc-600 hover:border-zinc-400"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-zinc-400">1 = very fatigued · 6 = fresh and ready</p>
      </div>

      {/* Structured check-in */}
      <div className="space-y-3 rounded-xl bg-zinc-50/60 border border-zinc-100 p-3">
        <ScaleRow
          label="Fatigue"
          hint="1 fresh → 5 wrecked"
          value={fatigue}
          onChange={setFatigue}
        />
        <ScaleRow
          label="Soreness"
          hint="1 none → 5 severe"
          value={soreness}
          onChange={(v) => {
            setSoreness(v);
            if (v === null || v < 3) setSorenessAreas([]);
          }}
        />
        {soreness !== null && soreness >= 3 && (
          <div className="space-y-1.5">
            <p className="text-[11px] text-zinc-500">Where? (tap all that apply)</p>
            <div className="flex flex-wrap gap-1.5">
              {SORENESS_AREAS.map((area) => (
                <button
                  key={area}
                  onClick={() =>
                    setSorenessAreas((prev) =>
                      prev.includes(area) ? prev.filter((a) => a !== area) : [...prev, area]
                    )
                  }
                  className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                    sorenessAreas.includes(area)
                      ? "bg-orange-600 text-white border-orange-600"
                      : "border-zinc-200 text-zinc-600 hover:border-zinc-400"
                  }`}
                >
                  {area}
                </button>
              ))}
            </div>
          </div>
        )}
        <ScaleRow
          label="Motivation"
          hint="1 low → 5 high"
          value={motivation}
          onChange={setMotivation}
        />
      </div>

      {/* Priorities */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-zinc-700">
          Focus next week
          {selectedPriorities.length > 0 && (
            <span className="ml-1.5 text-[10px] font-normal text-zinc-400">
              {selectedPriorities.length} selected
            </span>
          )}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {PRIORITY_OPTIONS.map((opt) => (
            <button
              key={opt}
              onClick={() => togglePriority(opt)}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                selectedPriorities.includes(opt)
                  ? "bg-zinc-900 text-white border-zinc-900"
                  : "border-zinc-200 text-zinc-600 hover:border-zinc-400"
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>

      {/* Training preferences */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-zinc-700">Training preferences</p>
        <textarea
          value={trainingPreferencesText}
          onChange={(e) => setTrainingPreferencesText(e.target.value)}
          placeholder="e.g. Marathon is close, but one easy bike if weather allows."
          rows={2}
          className={inputCls + " resize-none"}
        />
        <p className="text-[10px] text-zinc-400">Soft guidance — Claude weighs this alongside recovery and schedule.</p>
      </div>

      {/* Family constraints */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-zinc-700">Partner / family constraints</p>
        <textarea
          value={familyConstraints}
          onChange={(e) => setFamilyConstraints(e.target.value)}
          placeholder="e.g. Saturday afternoon is family time, Sunday morning free until 11"
          rows={2}
          className={inputCls + " resize-none"}
        />
      </div>

      {/* Locked-in fixed sessions for next week */}
      <FixedSessionsCard
        sessions={fixedSessions}
        onAdd={addFixedSession}
        onRemove={removeFixedSession}
      />

      {error && (
        <p className="text-xs text-red-600 rounded-xl bg-red-50 border border-red-100 px-3 py-2">{error}</p>
      )}

      <motion.button
        whileTap={{ scale: 0.98 }}
        onClick={submit}
        disabled={submitting}
        className="w-full rounded-xl bg-zinc-900 py-3 text-sm font-medium text-white disabled:opacity-50 hover:bg-zinc-800 transition-colors"
      >
        {submitting
          ? "Generating next week's plan…"
          : hasDraft
          ? "Update next week's plan"
          : "Generate next week's plan"}
      </motion.button>

      <button
        onClick={() => router.back()}
        className="w-full rounded-xl border border-zinc-200 py-2 text-sm text-zinc-500 hover:bg-zinc-50 transition-colors"
      >
        Cancel
      </button>
    </div>
  );

  return (
    <main className="relative min-h-screen px-4 lg:px-6 xl:px-8 pt-0 pb-24 lg:pb-8">
      {/* ── Hero header ──────────────────────────────────────────────── */}
      <div className="pt-6 pb-4">
        <div className="lg:rounded-2xl lg:bg-white/70 lg:backdrop-blur-sm lg:border lg:border-zinc-100/80 lg:shadow-sm lg:px-5 lg:py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1">Planning</p>
              <h1 className="text-[26px] font-bold tracking-tight text-zinc-900 leading-none">Review & Plan</h1>
              <p className="text-sm text-zinc-500 mt-1">
                Turn this week&apos;s signals into the next adaptive plan.
              </p>
            </div>
            <button
              onClick={() => router.push("/history")}
              className="shrink-0 rounded-xl border border-zinc-200 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50 transition-colors"
            >
              History &amp; trends →
            </button>
          </div>
        </div>
      </div>

      <PageWrapper>
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-6 lg:items-start">
          {/* ── Main column: action card (primary) ─────────────────────── */}
          <StaggerList className="space-y-3">
            {/* Action card — primary on both mobile and desktop */}
            <StaggerItem>
              {ActionCard}
            </StaggerItem>

            {/* Stats — secondary on mobile (below action); hidden on desktop (in side rail) */}
            <div className="lg:hidden space-y-3">
              {weeklyStats === undefined ? (
                <div className="rounded-2xl bg-white border border-zinc-100 shadow-card px-4 py-3">
                  <p className="text-xs text-zinc-400">Loading week summary…</p>
                </div>
              ) : weeklyStats !== null ? (
                <>
                  <StatsBlock stats={weeklyStats} />
                  <ExecQualityBlock eq={weeklyStats.executionQuality} />
                  <SignalsBlock signals={weeklyStats.signals} />
                  <div className="rounded-2xl bg-white border border-zinc-100 shadow-card px-4 py-3 space-y-2">
                    <button
                      onClick={() => setSessionDetailOpen((v) => !v)}
                      className="w-full flex items-center justify-between text-left"
                    >
                      <span className="text-xs font-semibold text-zinc-500">Session details</span>
                      <span className="text-[10px] text-zinc-400">{sessionDetailOpen ? "▲ hide" : "▼ show"}</span>
                    </button>
                    {sessionDetailOpen && (
                      <div className="pt-1 border-t border-zinc-100">
                        <SessionDayList stats={weeklyStats} />
                      </div>
                    )}
                  </div>
                </>
              ) : null}
              {weeklyStats && weeklyStats.carryForward.length > 0 && (
                <CarryForwardBlock bullets={weeklyStats.carryForward} />
              )}
              {archivePlan && (
                <PreviousWeekBlock
                  plan={archivePlan}
                  open={archiveOpen}
                  onToggle={() => setArchiveOpen((v) => !v)}
                />
              )}
            </div>
          </StaggerList>

          {/* ── Side rail: stats context (desktop only) ────────────────── */}
          <aside className="hidden lg:flex lg:flex-col lg:gap-3">
            {weeklyStats === undefined ? (
              <div className="rounded-2xl bg-white border border-zinc-100 shadow-card px-4 py-3">
                <p className="text-xs text-zinc-400">Loading week summary…</p>
              </div>
            ) : weeklyStats !== null ? (
              <>
                <StatsBlock stats={weeklyStats} />
                <ExecQualityBlock eq={weeklyStats.executionQuality} />
                <SignalsBlock signals={weeklyStats.signals} />
                <div className="rounded-2xl bg-white border border-zinc-100 shadow-card px-4 py-3 space-y-2">
                  <button
                    onClick={() => setSessionDetailOpen((v) => !v)}
                    className="w-full flex items-center justify-between text-left"
                  >
                    <span className="text-xs font-semibold text-zinc-500">Session details</span>
                    <span className="text-[10px] text-zinc-400">{sessionDetailOpen ? "▲ hide" : "▼ show"}</span>
                  </button>
                  {sessionDetailOpen && (
                    <div className="pt-1 border-t border-zinc-100">
                      <SessionDayList stats={weeklyStats} />
                    </div>
                  )}
                </div>
              </>
            ) : null}
            {weeklyStats && weeklyStats.carryForward.length > 0 && (
              <CarryForwardBlock bullets={weeklyStats.carryForward} />
            )}
            {archivePlan && (
              <PreviousWeekBlock
                plan={archivePlan}
                open={archiveOpen}
                onToggle={() => setArchiveOpen((v) => !v)}
              />
            )}
          </aside>
        </div>
      </PageWrapper>
    </main>
  );
}

// ── Review sub-components ─────────────────────────────────────────────────────

function MetricPill({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] font-semibold uppercase tracking-widest text-zinc-400">{label}</span>
      <span className={`text-sm font-semibold tabular-nums leading-none ${accent ? "text-red-600" : "text-zinc-800"}`}>
        {value}
      </span>
    </div>
  );
}

function ScaleRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-medium text-zinc-700">{label}</p>
        <p className="text-[10px] text-zinc-400">{hint}</p>
      </div>
      <div className="flex gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            onClick={() => onChange(value === n ? null : n)}
            className={`h-8 flex-1 rounded-lg border text-xs font-medium transition-colors ${
              value === n
                ? "bg-zinc-900 text-white border-zinc-900"
                : "border-zinc-200 text-zinc-600 hover:border-zinc-400"
            }`}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

const FIXED_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const FIXED_SLOTS = ["morning", "daytime", "afternoon", "evening"];
const FIXED_MODALITIES = ["running", "hyrox", "cycling", "swimming"];
const FIXED_INTENSITIES = ["easy", "moderate", "hard"];

function FixedSessionsCard({
  sessions,
  onAdd,
  onRemove,
}: {
  sessions: FixedSessionRow[];
  onAdd: (input: {
    dayOffset: number;
    preferredSlot: string;
    durationMin: number;
    intensity: string;
    modality: string;
    notes: string;
  }) => Promise<void>;
  onRemove: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [dayOffset, setDayOffset] = useState(5); // Sat
  const [slot, setSlot] = useState("morning");
  const [modality, setModality] = useState("running");
  const [durationMin, setDurationMin] = useState(60);
  const [intensity, setIntensity] = useState("moderate");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const selCls =
    "rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-800 focus:outline-none focus:ring-1 focus:ring-zinc-300";

  async function handleAdd() {
    setSaving(true);
    await onAdd({ dayOffset, preferredSlot: slot, durationMin, intensity, modality, notes: note });
    setNote("");
    setSaving(false);
    setOpen(false);
  }

  return (
    <div className="space-y-2 rounded-xl border border-zinc-100 bg-zinc-50/60 p-3">
      <div>
        <p className="text-xs font-medium text-zinc-700">Locked-in sessions next week</p>
        <p className="text-[10px] text-zinc-400">
          Sessions you already know about. The plan builds around these.
        </p>
      </div>

      {sessions.length > 0 && (
        <div className="space-y-1.5">
          {sessions.map((s) => {
            const d = new Date(s.scheduledDate + "T12:00:00Z");
            const dayName = FIXED_DAYS[(d.getUTCDay() + 6) % 7];
            return (
              <div
                key={s.id}
                className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5"
              >
                <span className="text-xs text-zinc-700">
                  {dayName} · <span className="capitalize">{s.preferredSlot}</span> ·{" "}
                  <span className="capitalize">{s.modality}</span> · {s.durationMin}m ·{" "}
                  <span className="capitalize">{s.intensity}</span>
                  {s.notes ? <span className="text-zinc-400"> — {s.notes}</span> : null}
                </span>
                <button
                  onClick={() => onRemove(s.id)}
                  className="ml-2 shrink-0 text-zinc-400 hover:text-red-600 text-sm leading-none"
                  aria-label="Remove"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}

      {open ? (
        <div className="space-y-2 rounded-lg border border-zinc-200 bg-white p-2.5">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] text-zinc-400">Day</span>
              <select className={selCls} value={dayOffset} onChange={(e) => setDayOffset(Number(e.target.value))}>
                {FIXED_DAYS.map((d, i) => (
                  <option key={d} value={i}>{d}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] text-zinc-400">Slot</span>
              <select className={selCls} value={slot} onChange={(e) => setSlot(e.target.value)}>
                {FIXED_SLOTS.map((s) => (
                  <option key={s} value={s} className="capitalize">{s}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] text-zinc-400">Type</span>
              <select className={selCls} value={modality} onChange={(e) => setModality(e.target.value)}>
                {FIXED_MODALITIES.map((m) => (
                  <option key={m} value={m} className="capitalize">{m}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] text-zinc-400">Duration (min)</span>
              <input
                type="number"
                min={10}
                max={360}
                step={5}
                value={durationMin}
                onChange={(e) => setDurationMin(Number(e.target.value))}
                className={selCls}
              />
            </label>
          </div>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-zinc-400">Intensity</span>
            <div className="flex gap-1.5">
              {FIXED_INTENSITIES.map((i) => (
                <button
                  key={i}
                  onClick={() => setIntensity(i)}
                  className={`flex-1 rounded-lg border px-2 py-1.5 text-xs capitalize transition-colors ${
                    intensity === i
                      ? "bg-zinc-900 text-white border-zinc-900"
                      : "border-zinc-200 text-zinc-600 hover:border-zinc-400"
                  }`}
                >
                  {i}
                </button>
              ))}
            </div>
          </label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (e.g. Group long run)"
            className={selCls + " w-full"}
          />
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={saving}
              className="flex-1 rounded-lg bg-zinc-900 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              {saving ? "Adding…" : "Add"}
            </button>
            <button
              onClick={() => setOpen(false)}
              className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs text-zinc-500"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="w-full rounded-lg border border-dashed border-zinc-300 py-2 text-xs font-medium text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 transition-colors"
        >
          + Add fixed session
        </button>
      )}
    </div>
  );
}

function StatsBlock({ stats }: { stats: WeeklyStats }) {
  const adherenceColor =
    stats.adherenceByCount >= 80
      ? "text-emerald-600"
      : stats.adherenceByCount >= 60
      ? "text-amber-600"
      : "text-red-600";

  return (
    <div className="rounded-2xl bg-white border border-zinc-100 shadow-card px-4 py-3 space-y-3">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
        This week · {stats.weekStart}
      </p>
      <div className="grid grid-cols-3 gap-x-5 gap-y-3">
        <MetricPill label="Planned" value={String(stats.planned)} />
        <MetricPill label="Done" value={String(stats.done)} />
        {stats.skipped > 0
          ? <MetricPill label="Skipped" value={String(stats.skipped)} accent />
          : <div />
        }
        <MetricPill label="Planned" value={fmtMin(stats.plannedDurationMin)} />
        {stats.actualMovingMin != null && (
          <MetricPill label="Actual" value={fmtMin(stats.actualMovingMin)} />
        )}
        {stats.hardPlanned > 0 && (
          <MetricPill label="Hard" value={`${stats.hardDone}/${stats.hardPlanned}`} accent={stats.hardDone < stats.hardPlanned} />
        )}
      </div>
      {(stats.plannedRunningKm != null || stats.actualRunningKm != null) && (
        <div className="flex items-center gap-4 pt-1 border-t border-zinc-100">
          {stats.plannedRunningKm != null && (
            <MetricPill label="Run planned" value={`${stats.plannedRunningKm} km`} />
          )}
          {stats.actualRunningKm != null && (
            <MetricPill label="Run actual" value={`${stats.actualRunningKm} km`} />
          )}
        </div>
      )}
      <div className="flex items-center gap-1.5 pt-0.5">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">Adherence</span>
        <span className={`text-sm font-bold tabular-nums ${adherenceColor}`}>{stats.adherenceByCount}%</span>
        {stats.adherenceByDuration != null && (
          <span className="text-xs text-zinc-400">sessions · {stats.adherenceByDuration}% duration</span>
        )}
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
    { label: "Split", count: eq.splitSessions },
  ].filter((item) => item.count > 0);

  if (items.length === 0) return null;

  return (
    <div className="rounded-2xl bg-white border border-zinc-100 shadow-card px-4 py-3 space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">Execution quality</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <span
            key={item.label}
            className="rounded-full bg-zinc-50 border border-zinc-200 px-2 py-0.5 text-xs text-zinc-600"
          >
            {item.label} · {item.count}
          </span>
        ))}
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
    <div className="rounded-2xl bg-amber-50 border border-amber-100 px-4 py-3 space-y-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-600">Signals this week</p>
      <div className="space-y-0.5">
        {signals.lowReadinessDays > 0 && (
          <p className="text-xs text-amber-800">
            Low readiness: {signals.lowReadinessDays} day{signals.lowReadinessDays > 1 ? "s" : ""}
          </p>
        )}
        {signals.fatigueDays > 0 && (
          <p className="text-xs text-amber-800">
            Fatigue: {signals.fatigueDays} check-in{signals.fatigueDays > 1 ? "s" : ""}
          </p>
        )}
        {signals.injuryDays > 0 && (
          <p className="text-xs text-orange-800 font-medium">
            Injury: {signals.injuryDays} check-in{signals.injuryDays > 1 ? "s" : ""}
          </p>
        )}
        {signals.unresolvedIssues > 0 && (
          <p className="text-xs font-semibold text-red-700">
            Unresolved issues: {signals.unresolvedIssues}
          </p>
        )}
        {signals.mainLimiter && (
          <p className="text-xs italic text-amber-700">Main limiter: {signals.mainLimiter}</p>
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

  if (stats.sessions.length === 0) return null;

  return (
    <div className="space-y-1.5 pt-1">
      {weekDays.map((dateStr, i) => {
        const daySessions = sessionsByDate.get(dateStr) ?? [];
        const dayLabel = WEEK_DOW[i];
        const dayNum = dateStr.slice(8);

        if (daySessions.length === 0) {
          return (
            <div key={dateStr} className="flex items-baseline gap-2">
              <span className="text-xs text-zinc-400 w-14 shrink-0">{dayLabel} {dayNum}</span>
              <span className="text-xs text-zinc-300">Rest</span>
            </div>
          );
        }

        return (
          <div key={dateStr} className="space-y-1">
            <span className="text-xs text-zinc-400">{dayLabel} {dayNum}</span>
            {daySessions.map((s) => (
              <SessionRow key={s.id} session={s} />
            ))}
          </div>
        );
      })}
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
        s.execution.actualDistanceKm != null ? `${s.execution.actualDistanceKm} km` : null,
        s.execution.paceStr,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  return (
    <div className="rounded-xl bg-zinc-50 border border-zinc-100 px-3 py-2 space-y-0.5">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span
          className={`text-xs font-medium ${
            isDone ? "text-emerald-600" : isSkipped ? "text-zinc-400" : "text-zinc-400"
          }`}
        >
          {isDone ? "✓" : isSkipped ? "—" : "·"}
        </span>
        <span className="text-xs font-medium text-zinc-700">
          {formatIntensity(s.intensity)} · {s.durationMin}min
        </span>
        {noteLabel && (
          <span className="text-xs text-zinc-500">{noteLabel}</span>
        )}
        {isSkipped && <span className="text-xs text-zinc-400">(skipped)</span>}
        {!isDone && !isSkipped && <span className="text-xs text-zinc-400">(planned)</span>}
      </div>

      {isDone && actualLine && (
        <div className="flex items-baseline gap-1 flex-wrap">
          <span className="text-[10px] text-zinc-400">Actual</span>
          <span className="text-xs text-zinc-600">{actualLine}</span>
          <span className="text-[10px] text-zinc-400">{s.execution!.qualityLabel}</span>
        </div>
      )}

      {isDone && s.checkIn && (
        <p className="text-[10px] text-zinc-400">feel {s.checkIn.feelScore}/6</p>
      )}
    </div>
  );
}

function CarryForwardBlock({ bullets }: { bullets: string[] }) {
  if (bullets.length === 0) return null;

  return (
    <div className="rounded-2xl bg-white border border-zinc-100 shadow-card px-4 py-3 space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
        Carry into next week
      </p>
      <ul className="space-y-1">
        {bullets.map((b, i) => (
          <li key={i} className="text-xs text-zinc-700 flex items-start gap-1.5">
            <span className="text-zinc-300 mt-0.5 shrink-0 select-none">·</span>
            <span className="leading-relaxed">{b}</span>
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
    <div className="rounded-2xl bg-white border border-zinc-100 shadow-card px-4 py-3">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between text-left"
      >
        <span className="text-xs font-semibold text-zinc-500">
          Previous week · {plan.weekStart}
        </span>
        <span className="text-[10px] text-zinc-400">{open ? "▲ hide" : "▼ show"}</span>
      </button>

      {open && (
        <div className="mt-3 pt-3 border-t border-zinc-100 space-y-2">
          <p className="text-xs text-zinc-500">
            {plan.planned} sessions · {plan.done} done
            {plan.skipped > 0 ? ` · ${plan.skipped} skipped` : ""}
          </p>
          {plan.focusSummary && (
            <div className="space-y-0.5">
              {normalizeCoachBullets(plan.focusSummary)
                .split("\n\n")
                .filter((l) => l.trim())
                .map((line, i) => (
                  <p key={i} className="text-xs text-zinc-400 leading-relaxed">{line.replace(/^[•·]\s*/, "")}</p>
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
                    s.execution.actualDistanceKm != null ? `${s.execution.actualDistanceKm} km` : null,
                    s.execution.paceStr,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : null;

              return (
                <div key={s.id} className="rounded-xl bg-zinc-50 border border-zinc-100 px-2.5 py-1.5 space-y-0.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`text-[10px] ${isDone ? "text-emerald-600" : isSkipped ? "text-zinc-400" : "text-zinc-400"}`}>
                      {isDone ? "✓" : isSkipped ? "—" : "·"}
                    </span>
                    <span className="text-[11px] text-zinc-600">
                      {s.date.slice(5)} · {formatIntensity(s.intensity)} · {s.durationMin}min
                      {noteLabel ? ` · ${noteLabel}` : ""}
                    </span>
                  </div>
                  {isDone && actualLine && (
                    <p className="text-[10px] text-zinc-400">
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
