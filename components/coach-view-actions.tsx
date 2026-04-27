"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function CoachViewActions({
  sessionId,
  hasPlan,
}: {
  sessionId: string;
  hasPlan: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function generateOrRegenerate() {
    setLoading(true);
    try {
      await fetch(`/api/sessions/${sessionId}/workout-plan`, { method: "POST" });
      router.refresh();
    } catch {
      // non-fatal
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="pb-8">
      <button
        onClick={generateOrRegenerate}
        disabled={loading}
        className="w-full rounded bg-indigo-600 py-2.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {loading
          ? "Generating…"
          : hasPlan
          ? "Regenerate plan"
          : "Generate workout plan"}
      </button>
    </div>
  );
}
