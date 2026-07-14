"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";

export type GoalProp = {
  id: string;
  title: string;
  description: string | null;
  discipline: string | null;
  targetDate: string | null;
  priority: number | null;
  status: string;
};

const PRIORITY_CONFIG: Record<number, { label: string; bg: string; border: string; text: string }> = {
  1: { label: "Primary", bg: "bg-red-50", border: "border-red-100", text: "text-red-700" },
  2: { label: "Secondary", bg: "bg-amber-50", border: "border-amber-100", text: "text-amber-700" },
  3: { label: "Background", bg: "bg-zinc-50", border: "border-zinc-200", text: "text-zinc-500" },
};

function daysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
}

export function GoalCard({
  goal,
  onEdit,
  isNextUp,
}: {
  goal: GoalProp;
  onEdit?: () => void;
  isNextUp?: boolean;
}) {
  const [deleting, setDeleting] = useState(false);
  const qc = useQueryClient();

  async function deleteGoal(e: React.MouseEvent) {
    e.stopPropagation();
    setDeleting(true);
    await fetch(`/api/goals/${goal.id}`, { method: "DELETE" });
    qc.invalidateQueries({ queryKey: ["goals"] });
    setDeleting(false);
  }

  const pc = goal.priority ? PRIORITY_CONFIG[goal.priority] : null;
  const days = goal.targetDate ? daysUntil(goal.targetDate) : null;

  return (
    <motion.div
      whileHover={{ y: -1 }}
      transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
      onClick={onEdit}
      role={onEdit ? "button" : undefined}
      tabIndex={onEdit ? 0 : undefined}
      className={`rounded-2xl bg-white border shadow-card p-4 space-y-2.5 ${onEdit ? "cursor-pointer" : ""} ${
        isNextUp ? "border-indigo-200 ring-1 ring-indigo-100" : "border-zinc-100"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {isNextUp && (
            <p className="text-[10px] font-semibold uppercase tracking-widest text-indigo-500 mb-0.5">
              Next up
            </p>
          )}
          <h3 className="text-sm font-semibold text-zinc-900 leading-snug">{goal.title}</h3>
          {goal.description && (
            <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed">{goal.description}</p>
          )}
        </div>
        <button
          onClick={deleteGoal}
          disabled={deleting}
          className="shrink-0 text-xs text-zinc-400 hover:text-red-500 transition-colors disabled:opacity-40 pt-0.5"
        >
          {deleting ? "…" : "Delete"}
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {goal.discipline && (
          <span className="rounded-full bg-indigo-50 border border-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-600">
            {goal.discipline}
          </span>
        )}
        {pc && (
          <span className={`rounded-full ${pc.bg} border ${pc.border} px-2 py-0.5 text-[10px] font-semibold ${pc.text}`}>
            P{goal.priority} · {pc.label}
          </span>
        )}
        {goal.targetDate && (
          <span className="rounded-full bg-zinc-50 border border-zinc-200 px-2 py-0.5 text-[10px] font-medium text-zinc-500">
            {days !== null && days >= 0 ? `${days}d · ` : ""}{goal.targetDate.slice(0, 10)}
          </span>
        )}
      </div>
    </motion.div>
  );
}
