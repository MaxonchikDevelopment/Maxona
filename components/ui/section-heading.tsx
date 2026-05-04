import type { ReactNode } from "react";

export function SectionHeading({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p className={`text-[10px] font-semibold uppercase tracking-widest text-zinc-400 ${className}`}>
      {children}
    </p>
  );
}
