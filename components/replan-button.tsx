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
        className="rounded border px-3 py-1 text-sm disabled:opacity-50"
      >
        {loading ? "..." : mode === "generate" ? "Generate Plan" : "Replan"}
      </button>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
