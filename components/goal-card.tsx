"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

export type GoalProp = {
  id: string;
  title: string;
  description: string | null;
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

  return (
    <div className="flex items-start justify-between rounded border p-4">
      <div>
        <p className="font-medium">{goal.title}</p>
        {goal.description && (
          <p className="mt-1 text-sm text-gray-500">{goal.description}</p>
        )}
      </div>
      <button
        onClick={deleteGoal}
        disabled={deleting}
        className="ml-4 text-sm text-red-400 disabled:opacity-50"
      >
        {deleting ? "..." : "Delete"}
      </button>
    </div>
  );
}
