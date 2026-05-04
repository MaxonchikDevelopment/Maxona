import type { ReactNode } from "react";

type Variant = "default" | "tinted";
type Tint = "indigo" | "emerald" | "amber" | "orange" | "red";

const TINT_CLASSES: Record<Tint, string> = {
  indigo: "bg-indigo-50 border-indigo-100",
  emerald: "bg-emerald-50/70 border-emerald-100",
  amber: "bg-amber-50 border-amber-100",
  orange: "bg-orange-50 border-orange-200",
  red: "bg-red-50 border-red-100",
};

export function SurfaceCard({
  children,
  className = "",
  variant = "default",
  tint,
  compact = false,
}: {
  children: ReactNode;
  className?: string;
  variant?: Variant;
  tint?: Tint;
  compact?: boolean;
}) {
  const base = "rounded-2xl border";
  const padding = compact ? "px-3 py-2.5" : "p-4";
  const surface =
    variant === "tinted" && tint
      ? TINT_CLASSES[tint]
      : "bg-white border-zinc-100 shadow-card";

  return (
    <div className={`${base} ${padding} ${surface} ${className}`}>
      {children}
    </div>
  );
}
