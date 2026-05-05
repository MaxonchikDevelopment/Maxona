"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useRef } from "react";
import { GoalCard } from "@/components/goal-card";
import { PageWrapper, StaggerList, StaggerItem } from "@/components/ui/page-wrapper";
import type { GoalProp } from "@/components/goal-card";

const DISCIPLINES = ["HYROX", "Marathon", "Running", "Cycling", "Swimming", "General fitness"];

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

function CreateGoalForm({
  titleRef,
  onSuccess,
}: {
  titleRef: React.RefObject<HTMLInputElement | null>;
  onSuccess?: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [discipline, setDiscipline] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [priority, setPriority] = useState("");
  const qc = useQueryClient();

  const create = useMutation({
    mutationFn: (data: {
      title: string;
      description?: string;
      discipline?: string;
      targetDate?: string;
      priority?: number;
    }) =>
      fetch("/api/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goals"] });
      setTitle("");
      setDescription("");
      setDiscipline("");
      setTargetDate("");
      setPriority("");
      onSuccess?.();
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    create.mutate({
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
    <div className="rounded-2xl bg-white border border-zinc-100 shadow-card p-4 space-y-3">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">New goal</p>
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
          disabled={!title.trim() || create.isPending}
          className="w-full rounded-xl bg-zinc-900 py-2.5 text-sm font-medium text-white disabled:opacity-50 hover:bg-zinc-800 transition-colors"
        >
          {create.isPending ? "Adding…" : "Add Goal"}
        </button>
      </form>
    </div>
  );
}

export default function GoalsPage() {
  const titleRef = useRef<HTMLInputElement>(null);
  const { data: goals = [] } = useQuery<GoalProp[]>({
    queryKey: ["goals"],
    queryFn: () => fetch("/api/goals").then((r) => r.json()),
  });

  function focusForm() {
    setTimeout(() => titleRef.current?.focus(), 50);
  }

  return (
    <main className="relative min-h-screen px-4 lg:px-6 xl:px-8 pt-0 pb-24 lg:pb-8">
      {/* ── Hero header ──────────────────────────────────────────────── */}
      <div className="pt-6 pb-4">
        <div className="lg:rounded-2xl lg:bg-white/70 lg:backdrop-blur-sm lg:border lg:border-zinc-100/80 lg:shadow-sm lg:px-5 lg:py-4">
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
      </div>

      <PageWrapper>
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-6 lg:items-start">
          {/* ── Main: goals board ──────────────────────────────────────── */}
          <div className="space-y-3">
            {goals.length === 0 ? (
              <EmptyGoalsState onAddClick={focusForm} />
            ) : (
              <StaggerList className="space-y-3">
                {goals.map((g) => (
                  <StaggerItem key={g.id}>
                    <GoalCard goal={g} />
                  </StaggerItem>
                ))}
              </StaggerList>
            )}

            {/* Mobile: form below list */}
            <div className="lg:hidden space-y-3 mt-2">
              <CreateGoalForm titleRef={titleRef} />
              <GoalGuidanceCard />
            </div>
          </div>

          {/* ── Side rail: create + guidance ───────────────────────────── */}
          <aside className="hidden lg:flex lg:flex-col lg:gap-3">
            <CreateGoalForm titleRef={titleRef} />
            <GoalGuidanceCard />
          </aside>
        </div>
      </PageWrapper>
    </main>
  );
}
