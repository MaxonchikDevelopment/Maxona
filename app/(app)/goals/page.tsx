"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { GoalCard } from "@/components/goal-card";
import type { GoalProp } from "@/components/goal-card";

const DISCIPLINES = ["HYROX", "Marathon", "Running", "Cycling", "Swimming", "General fitness"];

export default function GoalsPage() {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [discipline, setDiscipline] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [priority, setPriority] = useState("");
  const qc = useQueryClient();

  const { data: goals = [] } = useQuery<GoalProp[]>({
    queryKey: ["goals"],
    queryFn: () => fetch("/api/goals").then((r) => r.json()),
  });

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

  return (
    <main className="p-4">
      <h1 className="mb-4 text-xl font-bold">Goals</h1>
      <form className="mb-4 space-y-2" onSubmit={handleSubmit}>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Goal title"
          className="w-full rounded border px-3 py-2 text-sm"
        />
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)"
          className="w-full rounded border px-3 py-2 text-sm"
        />
        <div className="flex gap-2">
          <select
            value={discipline}
            onChange={(e) => setDiscipline(e.target.value)}
            className="flex-1 rounded border px-3 py-2 text-sm text-gray-500"
          >
            <option value="">Discipline (optional)</option>
            {DISCIPLINES.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="w-32 rounded border px-3 py-2 text-sm text-gray-500"
          >
            <option value="">Priority</option>
            <option value="1">1 — Primary</option>
            <option value="2">2 — Secondary</option>
            <option value="3">3 — Background</option>
          </select>
        </div>
        <div className="flex flex-col gap-0.5">
          <label className="text-xs text-gray-500">Target date (optional)</label>
          <input
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            className="w-full rounded border px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={!title.trim() || create.isPending}
          className="w-full rounded bg-black py-2 text-sm text-white disabled:opacity-50"
        >
          {create.isPending ? "Adding..." : "Add Goal"}
        </button>
      </form>
      <div className="space-y-3">
        {goals.map((g) => (
          <GoalCard key={g.id} goal={g} />
        ))}
      </div>
    </main>
  );
}
