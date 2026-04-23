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
      ? "border-gray-200"
      : readiness.category === "injury"
      ? "border-red-200 bg-red-50"
      : readiness.category === "fatigue"
      ? "border-amber-100 bg-amber-50"
      : (score ?? 0) >= 5
      ? "border-green-200 bg-green-50"
      : "border-gray-200";

  const scoreColor =
    !score
      ? "text-gray-600"
      : score <= 2
      ? "text-red-600"
      : score <= 3
      ? "text-amber-600"
      : score >= 5
      ? "text-green-600"
      : "text-gray-600";

  const isPositive = (score ?? 0) >= 5;

  return (
    <div className={`rounded border p-4 space-y-2 ${cardBg}`}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700">Daily readiness</span>
        {readiness ? (
          <div className="flex items-center gap-2">
            <span className={`text-sm font-medium ${scoreColor}`}>{readiness.feelScore}/6</span>
            {!editing && (
              <button onClick={startEdit} className="text-xs text-gray-400 underline">
                edit
              </button>
            )}
          </div>
        ) : (
          !open && (
            <button onClick={() => setOpen(true)} className="text-sm text-blue-600">
              How are you feeling today?
            </button>
          )
        )}
      </div>

      {readiness && !open && (
        <div className="space-y-1">
          {readiness.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {readiness.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500"
                >
                  {TAG_LABELS[tag as ReadinessTag] ?? tag}
                </span>
              ))}
            </div>
          )}
          {readiness.notes && (
            <p className="text-xs text-gray-500 italic">&ldquo;{readiness.notes}&rdquo;</p>
          )}
          {readiness.coachAdvice && (
            <div className={`rounded px-2 py-1.5 ${isPositive ? "bg-green-50" : "bg-amber-50"}`}>
              <p className={`text-xs font-medium mb-0.5 ${isPositive ? "text-green-700" : "text-amber-700"}`}>
                Coach
              </p>
              <p className={`text-xs whitespace-pre-line ${isPositive ? "text-green-800" : "text-amber-800"}`}>
                {readiness.coachAdvice}
              </p>
            </div>
          )}
        </div>
      )}

      {open && (
        <div className="space-y-2 border-t pt-2">
          <p className="text-xs text-gray-400">How do you feel today? (1 = terrible, 6 = great)</p>
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <button
                key={n}
                onClick={() => setFeelScore(n)}
                className={`h-8 w-8 rounded border text-sm ${
                  feelScore === n ? "bg-black text-white" : ""
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
                className={`rounded border px-2 py-0.5 text-xs ${
                  tags.includes(tag)
                    ? "bg-black text-white border-black"
                    : "text-gray-500"
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
            className="w-full rounded border px-2 py-1 text-sm"
          />
          <div className="flex gap-2">
            <button
              onClick={submit}
              disabled={submitting}
              className="flex-1 rounded bg-black py-1 text-sm text-white disabled:opacity-50"
            >
              {submitting ? "Saving..." : editing ? "Update" : "Save"}
            </button>
            <button
              onClick={() => {
                setOpen(false);
                setEditing(false);
              }}
              className="rounded border px-3 py-1 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
