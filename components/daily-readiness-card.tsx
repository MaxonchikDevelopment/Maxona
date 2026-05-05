"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const TAGS = ["alcohol", "poor_sleep", "stress", "travel", "soreness", "stomach"] as const;
type ReadinessTag = typeof TAGS[number];

const TAG_LABELS: Record<ReadinessTag, string> = {
  alcohol: "Alcohol",
  poor_sleep: "Poor sleep",
  stress: "Stress",
  travel: "Travel",
  soreness: "Soreness",
  stomach: "Stomach",
};

export type ReadinessProp = {
  id: string;
  date: string;
  feelScore: number;
  notes: string | null;
  tags: string[];
  category: string;
  coachAdvice: string | null;
};

export function DailyReadinessCard({
  initialReadiness,
  todayStr,
}: {
  initialReadiness: ReadinessProp | null;
  todayStr: string;
}) {
  const router = useRouter();
  const [readiness, setReadiness] = useState<ReadinessProp | null>(initialReadiness);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [feelScore, setFeelScore] = useState(initialReadiness?.feelScore ?? 4);
  const [notes, setNotes] = useState(initialReadiness?.notes ?? "");
  const [tags, setTags] = useState<ReadinessTag[]>(
    (initialReadiness?.tags ?? []).filter((t): t is ReadinessTag =>
      (TAGS as readonly string[]).includes(t)
    )
  );
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setSubmitting(true);
    const res = await fetch("/api/readiness", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: todayStr, feelScore, notes, tags }),
    });
    const data = await res.json();
    setReadiness(data);
    setOpen(false);
    setEditing(false);
    setSubmitting(false);
    router.refresh();
  }

  function startEdit() {
    setFeelScore(readiness?.feelScore ?? 4);
    setNotes(readiness?.notes ?? "");
    setTags(
      (readiness?.tags ?? []).filter((t): t is ReadinessTag =>
        (TAGS as readonly string[]).includes(t)
      )
    );
    setEditing(true);
    setOpen(true);
  }

  function toggleTag(tag: ReadinessTag) {
    setTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }

  const score = readiness?.feelScore;
  const cardBg =
    !readiness
      ? "bg-white border-zinc-100 shadow-card"
      : readiness.category === "injury"
      ? "bg-red-50 border-red-100"
      : readiness.category === "fatigue"
      ? "bg-amber-50 border-amber-100"
      : (score ?? 0) >= 5
      ? "bg-emerald-50/70 border-emerald-100"
      : "bg-white border-zinc-100 shadow-card";

  const scoreColor =
    !score
      ? "text-zinc-600"
      : score <= 2
      ? "text-red-600"
      : score <= 3
      ? "text-amber-600"
      : score >= 5
      ? "text-emerald-600"
      : "text-zinc-600";

  const isPositive = (score ?? 0) >= 5;

  return (
    <div className={`rounded-2xl border p-4 space-y-2 ${cardBg}`}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-zinc-700">Daily readiness</span>
        {readiness ? (
          <div className="flex items-center gap-2">
            <span className={`text-sm font-semibold ${scoreColor}`}>{readiness.feelScore}/6</span>
            {!editing && (
              <button onClick={startEdit} className="text-xs text-zinc-400 underline hover:text-zinc-600 transition-colors">
                edit
              </button>
            )}
          </div>
        ) : (
          !open && (
            <button onClick={() => setOpen(true)} className="text-sm font-medium text-indigo-600 hover:text-indigo-700 transition-colors">
              How are you feeling?
            </button>
          )
        )}
      </div>

      {readiness && !open && (
        <div className="space-y-1.5">
          {readiness.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {readiness.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500"
                >
                  {TAG_LABELS[tag as ReadinessTag] ?? tag}
                </span>
              ))}
            </div>
          )}
          {readiness.notes && (
            <p className="text-xs text-zinc-500 italic">&ldquo;{readiness.notes}&rdquo;</p>
          )}
          {readiness.coachAdvice && (
            <div className={`rounded-xl px-3 py-2 ${isPositive ? "bg-emerald-50 border border-emerald-100" : "bg-amber-50 border border-amber-100"}`}>
              <p className={`text-[10px] font-semibold uppercase tracking-widest mb-0.5 ${isPositive ? "text-emerald-600" : "text-amber-600"}`}>
                Coach
              </p>
              <p className={`text-xs whitespace-pre-line ${isPositive ? "text-emerald-800" : "text-amber-800"}`}>
                {readiness.coachAdvice}
              </p>
            </div>
          )}
        </div>
      )}

      {open && (
        <div className="space-y-2.5 border-t border-zinc-100 pt-3">
          <p className="text-xs text-zinc-400">How do you feel today? (1 = terrible, 6 = great)</p>
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <button
                key={n}
                onClick={() => setFeelScore(n)}
                className={`h-9 w-9 rounded-xl border text-sm font-medium transition-colors ${
                  feelScore === n
                    ? "bg-zinc-900 text-white border-zinc-900"
                    : "border-zinc-200 text-zinc-600 hover:border-zinc-400"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {TAGS.map((tag) => (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  tags.includes(tag)
                    ? "bg-zinc-900 text-white border-zinc-900"
                    : "border-zinc-200 text-zinc-500 hover:border-zinc-400"
                }`}
              >
                {TAG_LABELS[tag]}
              </button>
            ))}
          </div>
          <input
            type="text"
            placeholder="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-800 placeholder-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-300"
          />
          <div className="flex gap-2">
            <button
              onClick={submit}
              disabled={submitting}
              className="flex-1 rounded-xl bg-zinc-900 py-2 text-sm font-medium text-white disabled:opacity-50 hover:bg-zinc-800 transition-colors"
            >
              {submitting ? "Saving…" : editing ? "Update" : "Save"}
            </button>
            <button
              onClick={() => {
                setOpen(false);
                setEditing(false);
              }}
              className="rounded-xl border border-zinc-200 px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
