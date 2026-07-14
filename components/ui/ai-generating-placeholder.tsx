export function AiGeneratingPlaceholder({
  label = "Generating…",
  tint = "emerald",
}: {
  label?: string;
  tint?: "emerald" | "indigo";
}) {
  const tintClasses =
    tint === "emerald"
      ? { bg: "bg-emerald-50/70", border: "border-emerald-100", dot: "bg-emerald-300", text: "text-emerald-600", bar: "bg-emerald-200/70" }
      : { bg: "bg-indigo-50", border: "border-indigo-100", dot: "bg-indigo-300", text: "text-indigo-600", bar: "bg-indigo-200/70" };

  return (
    <div className={`rounded-2xl border px-4 py-3 space-y-2.5 ${tintClasses.bg} ${tintClasses.border}`}>
      <div className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full animate-pulse ${tintClasses.dot}`} />
        <p className={`text-[10px] font-semibold uppercase tracking-widest ${tintClasses.text}`}>{label}</p>
      </div>
      <div className="space-y-1.5 animate-pulse">
        <div className={`h-2.5 rounded-full ${tintClasses.bar} w-3/4`} />
        <div className={`h-2.5 rounded-full ${tintClasses.bar} w-full`} />
        <div className={`h-2.5 rounded-full ${tintClasses.bar} w-5/6`} />
      </div>
    </div>
  );
}
