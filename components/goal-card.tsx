"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

export type GoalProp = {
  id: string;
  title: string;
  description: string | null;
  discipline: string | null;
  targetDate: string | null;
  priority: number | null;
  status: string;
};

export function GoalCard({ goal }: { goal: GoalProp }) {
  const [deleting, setDeleting] = useState(false);
  const qc = useQueryClient();

  async function deleteGoal() {
    setDeleting(true);
    await fetch(`/api/goals/${goal.id}`, { method: "DELETE" });
    qc.invalidateQueries({ queryKey: ["goals"] });
    setDeleting(false);
  }

  const priorityLabel = goal.priority === 1 ? "Primary" : goal.priority === 2 ? "Secondary" : goal.priority === 3 ? "Background" : null;

  return (
    <div className="flex items-start justify-between rounded border p-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-medium">{goal.title}</p>
          {goal.discipline && (
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">{goal.discipline}</span>
          )}
          {priorityLabel && (
            <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-600">P{goal.priority} {priorityLabel}</span>
          )}
        </div>
        {goal.description && (
          <p className="mt-1 text-sm text-gray-500">{goal.description}</p>
        )}
        {goal.targetDate && (
          <p className="mt-1 text-xs text-gray-400">Target: {goal.targetDate.slice(0, 10)}</p>
        )}
      </div>
      <button
        onClick={deleteGoal}
        disabled={deleting}
        className="ml-4 text-sm text-red-400 disabled:opacity-50 shrink-0"
      >
        {deleting ? "..." : "Delete"}
      </button>
    </div>
  );
}
