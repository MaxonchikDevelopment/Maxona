"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function ReplanButton({ mode = "replan" }: { mode?: "generate" | "replan" }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handle() {
    setLoading(true);
    setError(null);
    const url = mode === "generate" ? "/api/plans" : "/api/plans/replan";
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Something went wrong");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error — try again");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={handle}
        disabled={loading}
        className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100 hover:border-indigo-300 transition-colors disabled:opacity-50"
      >
        {loading ? "…" : mode === "generate" ? "Generate plan" : "Replan"}
      </button>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
