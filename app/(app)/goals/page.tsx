"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { GoalCard } from "@/components/goal-card";
import type { GoalProp } from "@/components/goal-card";

export default function GoalsPage() {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const qc = useQueryClient();

  const { data: goals = [] } = useQuery<GoalProp[]>({
    queryKey: ["goals"],
    queryFn: () => fetch("/api/goals").then((r) => r.json()),
  });

  const create = useMutation({
    mutationFn: (data: { title: string; description?: string }) =>
      fetch("/api/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goals"] });
      setTitle("");
      setDescription("");
    },
  });

  return (
    <main className="p-4">
      <h1 className="mb-4 text-xl font-bold">Goals</h1>
      <form
        className="mb-4 space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim())
            create.mutate({ title, description: description || undefined });
        }}
      >
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
