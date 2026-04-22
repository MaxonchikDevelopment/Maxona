"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const PRIORITY_OPTIONS = [
  "More HYROX this week",
  "Focus on running volume",
  "Easy recovery week",
  "Long ride priority",
  "Marathon pace work",
  "Balanced as usual",
];

export default function ReviewPage() {
  const router = useRouter();
  const [recoveryScore, setRecoveryScore] = useState<number | null>(null);
  const [priorityNote, setPriorityNote] = useState("");
  const [familyConstraints, setFamilyConstraints] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);

    const weeklyReview = {
      ...(recoveryScore !== null && { recoveryScore }),
      ...(priorityNote.trim() && { priorityNote: priorityNote.trim() }),
      ...(familyConstraints.trim() && { familyConstraints: familyConstraints.trim() }),
    };

    const parts: string[] = ["weekly review"];
    if (recoveryScore !== null) parts.push(`recovery ${recoveryScore}/5`);
    if (priorityNote.trim()) parts.push(`priority: ${priorityNote.trim()}`);
    if (familyConstraints.trim()) parts.push(`constraints: ${familyConstraints.trim()}`);

    try {
      const res = await fetch("/api/plans/replan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: parts.join(" · "),
          weeklyReview,
        }),
      });
      if (!res.ok) throw new Error("Replan failed");
      router.push("/week");
    } catch {
      setError("Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <main className="p-4 space-y-6">
      <h1 className="text-xl font-bold">Weekly Review</h1>
      <p className="text-sm text-gray-500">
        Tell the planner what this week looks like. Takes ~30 seconds and produces a much better plan.
      </p>

      {/* Recovery */}
      <section className="space-y-2">
        <h2 className="font-semibold text-sm">How are you feeling going into this week?</h2>
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              onClick={() => setRecoveryScore(n)}
              className={`h-10 w-10 rounded border text-sm font-medium ${
                recoveryScore === n ? "bg-black text-white border-black" : "border-gray-300"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-400">1 = very fatigued / injured · 5 = fresh and ready</p>
      </section>

      {/* Priority */}
      <section className="space-y-2">
        <h2 className="font-semibold text-sm">What do you want to prioritize this week?</h2>
        <div className="flex flex-wrap gap-2 mb-2">
          {PRIORITY_OPTIONS.map((opt) => (
            <button
              key={opt}
              onClick={() => setPriorityNote(priorityNote === opt ? "" : opt)}
              className={`rounded border px-3 py-1 text-xs ${
                priorityNote === opt ? "bg-black text-white border-black" : "border-gray-300"
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={priorityNote}
          onChange={(e) => setPriorityNote(e.target.value)}
          placeholder="Or type your own priority..."
          className="w-full rounded border px-3 py-2 text-sm"
        />
      </section>

      {/* Family / Partner Constraints */}
      <section className="space-y-2">
        <h2 className="font-semibold text-sm">Partner / family constraints this week</h2>
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
        {submitting ? "Updating plan..." : "Update this week's plan"}
      </button>

      <button
        onClick={() => router.back()}
        className="w-full rounded border py-2 text-sm text-gray-500"
      >
        Cancel
      </button>
    </main>
  );
}
