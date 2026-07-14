"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageWrapper, StaggerList, StaggerItem } from "@/components/ui/page-wrapper";

type KeySession = {
  date: string;
  label: string;
  intensity: string;
  status: string;
  feelScore: number | null;
  quality: string | null;
};

type WeekRow = {
  weekStart: string;
  weekEnd: string;
  planned: number;
  done: number;
  skipped: number;
  plannedDurationMin: number;
  actualMovingMin: number | null;
  adherenceByCount: number;
  hardPlanned: number;
  hardDone: number;
  avgFeelScore: number | null;
  mainLimiter: string | null;
  carryForward: string[];
  keySessions: KeySession[];
  narrative: string | null;
};

function fmtWeek(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function adherenceColor(pct: number): string {
  return pct >= 80 ? "text-emerald-600" : pct >= 60 ? "text-amber-600" : "text-red-600";
}

// Single-hue magnitude bars (sequential). One series → no legend needed.
function MiniBars({
  values,
  format,
  max,
}: {
  values: (number | null)[];
  format: (v: number) => string;
  max?: number;
}) {
  const nums = values.filter((v): v is number => v != null);
  if (nums.length === 0) return null;
  const peak = max ?? Math.max(...nums, 1);
  const last = nums[nums.length - 1];

  return (
    <div className="flex items-end gap-1 h-10">
      {values.map((v, i) => {
        const h = v == null ? 0 : Math.max(8, Math.round((v / peak) * 100));
        const isLast = i === values.length - 1;
        return (
          <div key={i} className="flex-1 flex flex-col justify-end" title={v == null ? "—" : format(v)}>
            <div
              className={`w-full rounded-[3px] ${isLast ? "bg-indigo-500" : "bg-indigo-200"}`}
              style={{ height: `${h}%`, minHeight: v == null ? "2px" : undefined }}
            />
          </div>
        );
      })}
      <span className="ml-1 shrink-0 self-center text-xs font-semibold tabular-nums text-zinc-700">
        {format(last)}
      </span>
    </div>
  );
}

function TrendRow({
  label,
  values,
  format,
  max,
}: {
  label: string;
  values: (number | null)[];
  format: (v: number) => string;
  max?: number;
}) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">{label}</p>
      <MiniBars values={values} format={format} max={max} />
    </div>
  );
}

export default function HistoryPage() {
  const router = useRouter();
  const [weeks, setWeeks] = useState<WeekRow[] | undefined>(undefined);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/plans/history")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setWeeks((data?.weeks as WeekRow[]) ?? []))
      .catch(() => setWeeks([]));
  }, []);

  // Oldest → newest for trend strips
  const chrono = weeks ? [...weeks].reverse() : [];
  const trend = chrono.slice(-8);

  return (
    <main className="relative min-h-screen px-4 lg:px-6 xl:px-8 pt-0 pb-24 lg:pb-8">
      <div className="pt-6 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1">Trends</p>
            <h1 className="text-[26px] font-bold tracking-tight text-zinc-900 leading-none">History &amp; trends</h1>
            <p className="text-sm text-zinc-500 mt-1">How the last few weeks actually went.</p>
          </div>
          <button
            onClick={() => router.push("/review")}
            className="shrink-0 rounded-xl border border-zinc-200 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50 transition-colors"
          >
            ← Review
          </button>
        </div>
      </div>

      <PageWrapper>
        {weeks === undefined ? (
          <div className="rounded-2xl bg-white border border-zinc-100 shadow-card px-4 py-3">
            <p className="text-xs text-zinc-400">Loading history…</p>
          </div>
        ) : weeks.length === 0 ? (
          <div className="rounded-2xl bg-white border border-zinc-100 shadow-card px-4 py-6 text-center">
            <p className="text-sm text-zinc-500">No completed weeks yet.</p>
            <p className="text-xs text-zinc-400 mt-1">
              A weekly summary is saved automatically when each plan rolls over.
            </p>
          </div>
        ) : (
          <StaggerList className="space-y-3 max-w-xl">
            {trend.length >= 2 && (
              <StaggerItem>
                <div className="rounded-2xl bg-white border border-zinc-100 shadow-card px-4 py-4 space-y-4">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
                    Last {trend.length} weeks
                  </p>
                  <TrendRow
                    label="Adherence"
                    values={trend.map((w) => w.adherenceByCount)}
                    format={(v) => `${v}%`}
                    max={100}
                  />
                  <TrendRow
                    label="Hard sessions done"
                    values={trend.map((w) => w.hardDone)}
                    format={(v) => String(v)}
                  />
                  <TrendRow
                    label="Avg feel"
                    values={trend.map((w) => w.avgFeelScore)}
                    format={(v) => v.toFixed(1)}
                    max={6}
                  />
                  <TrendRow
                    label="Volume (min)"
                    values={trend.map((w) => w.actualMovingMin ?? w.plannedDurationMin)}
                    format={(v) => `${Math.round(v / 60)}h`}
                  />
                </div>
              </StaggerItem>
            )}

            {weeks.map((w) => {
              const open = expanded === w.weekStart;
              return (
                <StaggerItem key={w.weekStart}>
                  <div className="rounded-2xl bg-white border border-zinc-100 shadow-card px-4 py-3">
                    <button
                      onClick={() => setExpanded(open ? null : w.weekStart)}
                      className="w-full flex items-center justify-between text-left gap-3"
                    >
                      <span className="text-sm font-semibold text-zinc-800">
                        Wk of {fmtWeek(w.weekStart)}
                      </span>
                      <span className="flex items-center gap-2 shrink-0">
                        <span className={`text-sm font-bold tabular-nums ${adherenceColor(w.adherenceByCount)}`}>
                          {w.adherenceByCount}%
                        </span>
                        <span className="text-xs text-zinc-400 tabular-nums">
                          {w.done}/{w.planned}
                        </span>
                        {w.avgFeelScore != null && (
                          <span className="text-xs text-zinc-400">feel {w.avgFeelScore}</span>
                        )}
                        <span className="text-[10px] text-zinc-400">{open ? "▲" : "▼"}</span>
                      </span>
                    </button>

                    {(w.narrative || w.mainLimiter) && !open && (
                      <p className="text-xs text-zinc-500 mt-1.5 line-clamp-1">
                        {w.narrative ?? `Main limiter: ${w.mainLimiter}`}
                      </p>
                    )}

                    {open && (
                      <div className="mt-3 pt-3 border-t border-zinc-100 space-y-2.5">
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                          <span>Hard {w.hardDone}/{w.hardPlanned}</span>
                          {w.skipped > 0 && <span className="text-amber-600">{w.skipped} skipped</span>}
                          {w.actualMovingMin != null && (
                            <span>{Math.round(w.actualMovingMin / 60)}h actual</span>
                          )}
                          {w.mainLimiter && <span className="italic">Limiter: {w.mainLimiter}</span>}
                        </div>

                        {w.keySessions.length > 0 && (
                          <div className="space-y-1">
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
                              Key sessions
                            </p>
                            {w.keySessions.map((s, i) => (
                              <div key={i} className="text-xs text-zinc-600 flex items-center gap-1.5">
                                <span className="text-zinc-400">{fmtWeek(s.date)}</span>
                                <span className="font-medium capitalize">{s.label}</span>
                                <span className="text-zinc-400 capitalize">· {s.intensity}</span>
                                {s.feelScore != null && <span className="text-zinc-400">· feel {s.feelScore}</span>}
                                {s.quality && <span className="text-zinc-400">· {s.quality}</span>}
                              </div>
                            ))}
                          </div>
                        )}

                        {w.carryForward.length > 0 && (
                          <ul className="space-y-1">
                            {w.carryForward.map((c, i) => (
                              <li key={i} className="text-xs text-zinc-600 flex items-start gap-1.5">
                                <span className="text-zinc-300 mt-0.5 shrink-0 select-none">·</span>
                                <span className="leading-relaxed">{c}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                </StaggerItem>
              );
            })}
          </StaggerList>
        )}
      </PageWrapper>
    </main>
  );
}
