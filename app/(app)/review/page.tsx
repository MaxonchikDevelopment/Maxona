"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

const PRIORITY_OPTIONS = [
  "More HYROX this week",
  "Focus on running volume",
  "Easy recovery week",
  "Long ride priority",
  "Marathon pace work",
  "Balanced as usual",
];

const DRAFT_KEY = "review_draft_v1";

type DraftState = {
  recoveryScore: number | null;
  selectedPriorities: string[];
  familyConstraints: string;
};

function loadDraft(): DraftState {
  if (typeof window === "undefined")
    return { recoveryScore: null, selectedPriorities: [], familyConstraints: "" };
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return { recoveryScore: null, selectedPriorities: [], familyConstraints: "" };
    return JSON.parse(raw) as DraftState;
  } catch {
    return { recoveryScore: null, selectedPriorities: [], familyConstraints: "" };
  }
}

export default function ReviewPage() {
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);
  const [recoveryScore, setRecoveryScore] = useState<number | null>(null);
  const [selectedPriorities, setSelectedPriorities] = useState<string[]>([]);
  const [familyConstraints, setFamilyConstraints] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Restore draft on mount
  useEffect(() => {
    const draft = loadDraft();
    setRecoveryScore(draft.recoveryScore);
    setSelectedPriorities(draft.selectedPriorities);
    setFamilyConstraints(draft.familyConstraints);
    setHydrated(true);
  }, []);

  // Persist draft on change
  useEffect(() => {
    if (!hydrated) return;
    const draft: DraftState = { recoveryScore, selectedPriorities, familyConstraints };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  }, [recoveryScore, selectedPriorities, familyConstraints, hydrated]);

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

  return (
    <main className="p-4 space-y-6">
      <div>
        <h1 className="text-xl font-bold">Plan next week</h1>
        <p className="text-sm text-gray-500 mt-1">
          Generates a draft plan for next week. Your current week is not affected.
        </p>
      </div>

      {/* Recovery */}
      <section className="space-y-2">
        <h2 className="font-semibold text-sm">How are you feeling going into next week?</h2>
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
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
        <p className="text-xs text-gray-400">1 = very fatigued / injured · 5 = fresh and ready</p>
      </section>

      {/* Priority — multi-select */}
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

      {/* Family / Partner Constraints */}
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
        {submitting ? "Generating next week's plan..." : "Generate next week's plan"}
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
