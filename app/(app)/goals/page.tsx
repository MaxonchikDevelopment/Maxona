"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, useRef } from "react";
import { GoalCard } from "@/components/goal-card";
import { PageWrapper, StaggerList, StaggerItem } from "@/components/ui/page-wrapper";
import { Dialog } from "@/components/ui/dialog";
import { computeGoalGuidance, type GoalPhase } from "@/lib/planner/goal-guidance";
import type { GoalProp } from "@/components/goal-card";

const DISCIPLINES = ["HYROX", "Marathon", "Running", "Cycling", "Swimming", "General fitness"];

const PHASE_LABEL: Record<GoalPhase, string> = { base: "Base", build: "Build", taper: "Taper" };

function localTodayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function compareGoals(a: GoalProp, b: GoalProp): number {
  if (a.targetDate && b.targetDate) {
    const cmp = a.targetDate.localeCompare(b.targetDate);
    if (cmp !== 0) return cmp;
  } else if (a.targetDate && !b.targetDate) {
    return -1;
  } else if (!a.targetDate && b.targetDate) {
    return 1;
  }
  return (a.priority ?? Infinity) - (b.priority ?? Infinity);
}

function EmptyGoalsState({ onAddClick }: { onAddClick: () => void }) {
  return (
    <div className="rounded-2xl bg-white border border-zinc-100 shadow-card px-5 py-10 flex flex-col items-center text-center gap-3">
      <div className="w-10 h-10 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center">
        <span className="text-indigo-500 text-xl leading-none">◎</span>
      </div>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-zinc-800">No active goals yet</p>
        <p className="text-xs text-zinc-400 max-w-[200px] leading-relaxed">
          Add a goal to give the planner a target to adapt your week around.
        </p>
      </div>
      <button
        onClick={onAddClick}
        className="rounded-xl bg-zinc-900 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-800 transition-colors"
      >
        Add first goal
      </button>
    </div>
  );
}

function GoalGuidanceCard() {
  const [expanded, setExpanded] = useState(false);
  const tips = [
    "Specific discipline — HYROX, Running, Cycling",
    "A target date gives the planner a timeline to work back from",
    "Priority 1 = primary focus · lower priorities balance around it",
    "Multiple active goals work — planner weights them by priority",
  ];
  const visible = expanded ? tips : tips.slice(0, 2);

  return (
    <div className="rounded-2xl bg-indigo-50 border border-indigo-100 px-4 py-3 space-y-1.5">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between text-left"
      >
        <p className="text-[10px] font-semibold uppercase tracking-widest text-indigo-500">
          Goal tips
        </p>
        <span className="text-[10px] text-indigo-400">{expanded ? "▲ less" : "▼ more"}</span>
      </button>
      <ul className="space-y-1">
        {visible.map((tip, i) => (
          <li key={i} className="text-xs text-indigo-800 flex items-start gap-1.5">
            <span className="text-indigo-300 mt-0.5 shrink-0 select-none">·</span>
            <span className="leading-relaxed">{tip}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function GoalWeekSummaryCard({ goals }: { goals: GoalProp[] }) {
  const activeGoals = goals.filter((g) => g.status === "active");
  const guidance = useMemo(
    () =>
      computeGoalGuidance(
        activeGoals.map((g) => ({
          id: g.id,
          title: g.title,
          discipline: g.discipline,
          targetDate: g.targetDate ? g.targetDate.slice(0, 10) : null,
          priority: g.priority,
        })),
        localTodayStr()
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(activeGoals)]
  );

  if (!guidance.primaryFocus) return null;

  const { primaryFocus, perGoal, taperGoal } = guidance;
  const sortedByWeight = [...perGoal].sort((a, b) => b.weight - a.weight);

  return (
    <div className="rounded-2xl bg-white border border-zinc-100 shadow-card px-4 py-3 space-y-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
        How your goals shape the week
      </p>
      <div className="space-y-0.5">
        <p className="text-sm font-semibold text-zinc-800 leading-snug">{primaryFocus.title}</p>
        <p className="text-xs text-zinc-500">
          {primaryFocus.daysUntil !== null ? `${primaryFocus.daysUntil}d to go · ` : "No target date · "}
          {PHASE_LABEL[primaryFocus.phase]} phase
        </p>
      </div>
      {taperGoal && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5 leading-relaxed">
          Tapering for {taperGoal.title} — reduced volume this week.
        </p>
      )}
      <div className="flex flex-wrap gap-1.5 pt-0.5">
        {sortedByWeight.map((g) => (
          <span
            key={g.id}
            className="rounded-full bg-zinc-50 border border-zinc-200 px-2 py-0.5 text-[10px] font-medium text-zinc-600"
          >
            {g.discipline ?? g.title} · {Math.round(g.weight * 100)}%
          </span>
        ))}
      </div>
    </div>
  );
}

function GoalForm({
  titleRef,
  initialGoal,
  onSuccess,
}: {
  titleRef: React.RefObject<HTMLInputElement | null>;
  initialGoal?: GoalProp;
  onSuccess?: () => void;
}) {
  const isEdit = !!initialGoal;
  const [title, setTitle] = useState(initialGoal?.title ?? "");
  const [description, setDescription] = useState(initialGoal?.description ?? "");
  const [discipline, setDiscipline] = useState(initialGoal?.discipline ?? "");
  const [targetDate, setTargetDate] = useState(initialGoal?.targetDate?.slice(0, 10) ?? "");
  const [priority, setPriority] = useState(initialGoal?.priority != null ? String(initialGoal.priority) : "");
  const qc = useQueryClient();

  const save = useMutation({
    mutationFn: (data: {
      title: string;
      description?: string;
      discipline?: string;
      targetDate?: string;
      priority?: number;
    }) =>
      fetch(isEdit ? `/api/goals/${initialGoal!.id}` : "/api/goals", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goals"] });
      if (!isEdit) {
        setTitle("");
        setDescription("");
        setDiscipline("");
        setTargetDate("");
        setPriority("");
      }
      onSuccess?.();
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    save.mutate({
      title,
      description: description || undefined,
      discipline: discipline || undefined,
      targetDate: targetDate || undefined,
      priority: priority ? Number(priority) : undefined,
    });
  }

  const inputCls =
    "w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-800 placeholder-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-300";
  const selectCls =
    "w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 focus:outline-none focus:ring-1 focus:ring-zinc-300";
  const labelCls = "text-xs font-medium text-zinc-500";

  return (
    <div className="space-y-3">
      <form className="space-y-2.5" onSubmit={handleSubmit}>
        <div className="space-y-1">
          <label className={labelCls}>Title</label>
          <input
            ref={titleRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Sub-50 HYROX finish"
            className={inputCls}
          />
        </div>
        <div className="space-y-1">
          <label className={labelCls}>Description</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional context"
            className={inputCls}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className={labelCls}>Discipline</label>
            <select
              value={discipline}
              onChange={(e) => setDiscipline(e.target.value)}
              className={selectCls}
            >
              <option value="">Any</option>
              {DISCIPLINES.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className={labelCls}>Priority</label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className={selectCls}
            >
              <option value="">Optional</option>
              <option value="1">P1 · Primary</option>
              <option value="2">P2 · Secondary</option>
              <option value="3">P3 · Background</option>
            </select>
          </div>
        </div>
        <div className="space-y-1">
          <label className={labelCls}>Target date</label>
          <input
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            className={inputCls}
          />
        </div>
        <button
          type="submit"
          disabled={!title.trim() || save.isPending}
          className="w-full rounded-xl bg-zinc-900 py-2.5 text-sm font-medium text-white disabled:opacity-50 hover:bg-zinc-800 transition-colors"
        >
          {save.isPending ? (isEdit ? "Saving…" : "Adding…") : isEdit ? "Save changes" : "Add Goal"}
        </button>
      </form>
    </div>
  );
}

export default function GoalsPage() {
  const [formOpen, setFormOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<GoalProp | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const editTitleRef = useRef<HTMLInputElement>(null);
  const { data: goals = [] } = useQuery<GoalProp[]>({
    queryKey: ["goals"],
    queryFn: () => fetch("/api/goals").then((r) => r.json()),
  });

  const sortedGoals = useMemo(() => [...goals].sort(compareGoals), [goals]);

  const nextUpId = useMemo(() => {
    const activeGoals = goals.filter((g) => g.status === "active");
    const guidance = computeGoalGuidance(
      activeGoals.map((g) => ({
        id: g.id,
        title: g.title,
        discipline: g.discipline,
        targetDate: g.targetDate ? g.targetDate.slice(0, 10) : null,
        priority: g.priority,
      })),
      localTodayStr()
    );
    return guidance.primaryFocus?.id ?? null;
  }, [goals]);

  return (
    <main className="relative min-h-screen px-4 lg:px-6 xl:px-8 pt-0 pb-24 lg:pb-8">
      {/* ── Hero header ──────────────────────────────────────────────── */}
      <div className="pt-6 pb-4">
        <div className="flex items-start justify-between gap-3 lg:rounded-2xl lg:bg-white/70 lg:backdrop-blur-sm lg:border lg:border-zinc-100/80 lg:shadow-sm lg:px-5 lg:py-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1">Training</p>
            <h1 className="text-[26px] font-bold tracking-tight text-zinc-900 leading-none">Goals</h1>
            <p className="text-sm text-zinc-500 mt-1">Give the planner a target to adapt around.</p>
            {goals.length > 0 && (
              <p className="text-xs text-zinc-400 mt-2">
                {goals.length} active goal{goals.length !== 1 ? "s" : ""}
                {goals.filter((g) => g.priority === 1).length > 0 &&
                  ` · ${goals.filter((g) => g.priority === 1).length} primary`}
              </p>
            )}
          </div>
          {goals.length > 0 && (
            <button
              onClick={() => setFormOpen(true)}
              className="shrink-0 rounded-xl bg-zinc-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-zinc-800 transition-colors"
            >
              + Add goal
            </button>
          )}
        </div>
      </div>

      <PageWrapper>
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-6 lg:items-start">
          {/* ── Main: goals board ──────────────────────────────────────── */}
          <div className="space-y-3">
            {sortedGoals.length === 0 ? (
              <EmptyGoalsState onAddClick={() => setFormOpen(true)} />
            ) : (
              <StaggerList className="space-y-3">
                {sortedGoals.map((g) => (
                  <StaggerItem key={g.id}>
                    <GoalCard
                      goal={g}
                      onEdit={() => setEditingGoal(g)}
                      isNextUp={g.id === nextUpId}
                    />
                  </StaggerItem>
                ))}
              </StaggerList>
            )}

            {/* Mobile: guidance below list */}
            <div className="lg:hidden mt-2 space-y-3">
              <GoalWeekSummaryCard goals={goals} />
              <GoalGuidanceCard />
            </div>
          </div>

          {/* ── Side rail: guidance ─────────────────────────────────────── */}
          <aside className="hidden lg:flex lg:flex-col lg:gap-3">
            <GoalGuidanceCard />
            <GoalWeekSummaryCard goals={goals} />
          </aside>
        </div>
      </PageWrapper>

      <Dialog open={formOpen} onClose={() => setFormOpen(false)} title="New goal">
        <GoalForm titleRef={titleRef} onSuccess={() => setFormOpen(false)} />
      </Dialog>

      <Dialog open={!!editingGoal} onClose={() => setEditingGoal(null)} title="Edit goal">
        {editingGoal && (
          <GoalForm
            titleRef={editTitleRef}
            initialGoal={editingGoal}
            onSuccess={() => setEditingGoal(null)}
          />
        )}
      </Dialog>
    </main>
  );
}
