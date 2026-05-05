import type { ReactNode } from "react";

export function GlassPanel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl bg-white/70 backdrop-blur-sm border border-zinc-100/80 shadow-sm ${className}`}
    >
      {children}
    </div>
  );
}
