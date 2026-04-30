import type { HrAnalytics, HrZoneStat, HrChartData } from "@/lib/analytics/hr-stream";

// Tailwind color classes per zone — chosen for readability and accessibility
const ZONE_COLOR: Record<string, string> = {
  Z1: "bg-blue-100 text-blue-700",
  Z2: "bg-green-100 text-green-700",
  Z3: "bg-yellow-100 text-yellow-700",
  Z4: "bg-orange-100 text-orange-800",
  Z5: "bg-red-100 text-red-700",
};

const ZONE_BAR_COLOR: Record<string, string> = {
  Z1: "bg-blue-300",
  Z2: "bg-green-400",
  Z3: "bg-yellow-400",
  Z4: "bg-orange-400",
  Z5: "bg-red-500",
};

// SVG line chart — pure server-renderable markup
function HrLineChart({ chart }: { chart: HrChartData }) {
  const W = 400;
  const H = 100;
  const PAD = { t: 10, b: 18, l: 28, r: 8 };
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;

  const { points, avgHr, peakHr } = chart;
  if (points.length < 2) return null;

  const maxMin = points[points.length - 1].minute;
  const rawMin = Math.min(...points.map((p) => p.hr));
  const rawMax = Math.max(...points.map((p) => p.hr));
  const yMin = Math.max(30, rawMin - 10);
  const yMax = Math.min(230, rawMax + 10);
  const yRange = yMax - yMin || 1;

  function toX(minute: number) {
    return PAD.l + (minute / (maxMin || 1)) * innerW;
  }
  function toY(hr: number) {
    return PAD.t + innerH - ((hr - yMin) / yRange) * innerH;
  }

  const polyline = points.map((p) => `${toX(p.minute)},${toY(p.hr)}`).join(" ");
  const avgY = toY(avgHr);
  const peakY = toY(peakHr);

  // Axis tick labels
  const midMin = Math.round(maxMin / 2);
  const yMid = Math.round((yMin + yMax) / 2);

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${W} ${H}`}
      className="overflow-visible"
      aria-label={`HR over time: avg ${avgHr}, peak ${peakHr}`}
    >
      {/* Avg HR dashed guide */}
      <line
        x1={PAD.l}
        y1={avgY}
        x2={PAD.l + innerW}
        y2={avgY}
        stroke="#94a3b8"
        strokeWidth={0.8}
        strokeDasharray="4,3"
      />

      {/* Peak HR marker */}
      {peakY < avgY - 4 && (
        <line
          x1={PAD.l}
          y1={peakY}
          x2={PAD.l + innerW}
          y2={peakY}
          stroke="#fca5a5"
          strokeWidth={0.5}
          strokeDasharray="2,4"
        />
      )}

      {/* HR polyline */}
      <polyline
        points={polyline}
        fill="none"
        stroke="#6366f1"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* Y axis labels */}
      <text x={PAD.l - 3} y={PAD.t + 4} textAnchor="end" fontSize={7} fill="#9ca3af">
        {yMax}
      </text>
      <text x={PAD.l - 3} y={PAD.t + innerH / 2 + 3} textAnchor="end" fontSize={7} fill="#9ca3af">
        {yMid}
      </text>
      <text x={PAD.l - 3} y={PAD.t + innerH + 3} textAnchor="end" fontSize={7} fill="#9ca3af">
        {yMin}
      </text>

      {/* X axis labels */}
      <text x={PAD.l} y={H - 2} textAnchor="middle" fontSize={7} fill="#9ca3af">
        0
      </text>
      {midMin > 0 && (
        <text x={toX(midMin)} y={H - 2} textAnchor="middle" fontSize={7} fill="#9ca3af">
          {midMin}m
        </text>
      )}
      <text x={PAD.l + innerW} y={H - 2} textAnchor="end" fontSize={7} fill="#9ca3af">
        {Math.round(maxMin)}m
      </text>

      {/* Avg label */}
      <text x={PAD.l + innerW + 2} y={avgY + 3} fontSize={7} fill="#94a3b8">
        avg
      </text>
    </svg>
  );
}

function ZoneBars({ zones }: { zones: HrZoneStat[] }) {
  const nonZero = zones.filter((z) => z.seconds > 0);
  if (nonZero.length === 0) return null;

  return (
    <div className="space-y-1">
      {zones.map((z) => (
        <div key={z.zone} className="flex items-center gap-2">
          <span
            className={`text-[10px] font-medium rounded px-1 py-0.5 w-14 text-center shrink-0 ${ZONE_COLOR[z.zone]}`}
          >
            {z.zone} {z.label}
          </span>
          <div className="flex-1 h-2 rounded bg-gray-100 overflow-hidden">
            <div
              className={`h-full rounded transition-all ${ZONE_BAR_COLOR[z.zone]}`}
              style={{ width: `${z.percent}%` }}
            />
          </div>
          <span className="text-[10px] text-gray-500 w-12 text-right shrink-0">
            {z.minutes > 0 ? `${z.minutes}m` : "<1m"} · {z.percent}%
          </span>
        </div>
      ))}
    </div>
  );
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded bg-gray-50 border px-3 py-2 text-center">
      <p className="text-[10px] text-gray-400 uppercase tracking-wide">{label}</p>
      <p className="text-sm font-semibold text-gray-800 mt-0.5">{value}</p>
    </div>
  );
}

export function SessionAnalytics({
  analytics,
  calories,
}: {
  analytics: HrAnalytics;
  calories?: number | null;
}) {
  const { chart, zones, insights } = analytics;
  const mainZone = zones ? [...zones].sort((a, b) => b.seconds - a.seconds)[0] : null;

  return (
    <div className="space-y-4">
      {/* Section header */}
      <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-400">
        HR Analytics
      </p>

      {/* Summary stat cards */}
      <div className="grid grid-cols-2 gap-2">
        <StatCard label="Avg HR" value={`${chart.avgHr} bpm`} />
        <StatCard label="Peak HR" value={`${chart.peakHr} bpm`} />
        <StatCard label="Duration" value={`${chart.durationMin} min`} />
        {calories != null ? (
          <StatCard label="Calories" value={`${Math.round(calories)} kcal`} />
        ) : mainZone ? (
          <StatCard label="Main zone" value={`${mainZone.zone} ${mainZone.label}`} />
        ) : null}
      </div>

      {/* HR over time chart */}
      <div className="space-y-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
          Heart rate over time
        </p>
        <div className="rounded border bg-white px-2 pt-2 pb-1">
          <HrLineChart chart={chart} />
        </div>
        <p className="text-[10px] text-gray-400">
          — avg {chart.avgHr} bpm{" "}
          {chart.peakHr > chart.avgHr + 5 ? `· peak ${chart.peakHr} bpm` : ""}
        </p>
      </div>

      {/* Time in zones */}
      {zones && (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            Time in zones
          </p>
          <ZoneBars zones={zones} />
        </div>
      )}

      {/* Coach interpretation */}
      <div className="rounded border-l-[3px] border-indigo-200 bg-indigo-50 px-3 py-2 space-y-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-400">
          Execution read
        </p>
        {insights.map((line, i) => (
          <p key={i} className="text-xs text-indigo-800">
            {i === 0 ? line : `• ${line}`}
          </p>
        ))}
      </div>
    </div>
  );
}
