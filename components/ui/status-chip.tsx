type IntensityChipProps = { intensity: string; className?: string };

const INTENSITY_STYLES: Record<string, string> = {
  easy: "bg-emerald-50 text-emerald-700 border border-emerald-100",
  moderate: "bg-amber-50 text-amber-700 border border-amber-100",
  hard: "bg-red-50 text-red-700 border border-red-100",
};

export function IntensityChip({ intensity, className = "" }: IntensityChipProps) {
  const style = INTENSITY_STYLES[intensity] ?? "bg-zinc-100 text-zinc-600";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${style} ${className}`}>
      {intensity}
    </span>
  );
}

type PlanningTypeChipProps = { planningType: string; className?: string };

export function PlanningTypeChip({ planningType, className = "" }: PlanningTypeChipProps) {
  const styles: Record<string, string> = {
    fixed: "bg-zinc-100 text-zinc-500",
    preferred: "bg-indigo-50 text-indigo-600",
    manual: "bg-purple-50 text-purple-500",
    generated: "",
  };
  const style = styles[planningType];
  if (!style) return null;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${style} ${className}`}>
      {planningType}
    </span>
  );
}

type StatusChipProps = {
  status: "done" | "skipped" | "upcoming" | "planned";
  feelScore?: number;
  resolved?: boolean;
  className?: string;
};

export function StatusChip({ status, feelScore, resolved, className = "" }: StatusChipProps) {
  if (status === "done" || status === "planned" && feelScore != null) {
    const isDone = status === "done";
    return (
      <span className={`text-xs font-medium ${resolved ? "text-zinc-400" : "text-emerald-600"} ${className}`}>
        {resolved ? "Done · resolved" : isDone && feelScore != null ? `Done · ${feelScore}/6` : "Done"}
      </span>
    );
  }
  if (status === "skipped") {
    return <span className={`text-xs text-zinc-400 ${className}`}>Skipped</span>;
  }
  if (status === "upcoming") {
    return <span className={`text-xs text-zinc-400 ${className}`}>Upcoming</span>;
  }
  return null;
}
