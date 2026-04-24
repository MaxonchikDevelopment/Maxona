export type SignalHistoryItem = {
  date: string;
  source: "readiness" | "workout";
  feelScore: number;
  category: string;
  notePreview: string | null;
  sessionLabel: string | null;
  resolvedAt: string | null;
};

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shortDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
}

export function SignalsHistory({ items }: { items: SignalHistoryItem[] }) {
  if (items.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Recent signals · 7 days</p>
      <div className="space-y-1">
        {items.map((item, i) => {
          const isOk = item.category === "ok";
          const isInjury = item.category === "injury";
          const isResolved = !!item.resolvedAt;

          return (
            <div
              key={i}
              className={`flex items-baseline gap-2 text-xs ${isOk ? "text-gray-400" : "text-gray-700"}`}
            >
              <span className="w-[78px] shrink-0 text-gray-400 tabular-nums">{shortDate(item.date)}</span>
              <span
                className={`shrink-0 rounded px-1 py-0.5 text-[10px] font-medium leading-tight ${
                  item.source === "workout"
                    ? "bg-gray-100 text-gray-500"
                    : "bg-blue-50 text-blue-500"
                }`}
              >
                {item.source === "workout"
                  ? cap(item.sessionLabel ?? "session")
                  : "readiness"}
              </span>
              <span
                className={`shrink-0 font-medium tabular-nums ${
                  item.feelScore <= 2
                    ? "text-red-500"
                    : item.feelScore <= 3
                    ? "text-amber-500"
                    : item.feelScore >= 5
                    ? "text-green-600"
                    : "text-gray-500"
                }`}
              >
                {item.feelScore}/6
              </span>
              {!isOk && (
                <span
                  className={`shrink-0 rounded px-1 py-0.5 text-[10px] font-medium leading-tight ${
                    isInjury
                      ? isResolved
                        ? "bg-gray-100 text-gray-400"
                        : "bg-red-50 text-red-600"
                      : "bg-amber-50 text-amber-600"
                  }`}
                >
                  {isInjury ? "Injury" : "Fatigue"}
                  {isResolved ? " ✓" : ""}
                </span>
              )}
              {item.notePreview && (
                <span className="min-w-0 truncate text-gray-400 italic">{item.notePreview}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
