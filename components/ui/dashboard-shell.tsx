import type { ReactNode } from "react";

export function DashboardShell({
  main,
  side,
}: {
  main: ReactNode;
  side: ReactNode;
}) {
  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-6 lg:items-start">
      <div className="min-w-0">{main}</div>
      <aside className="hidden lg:flex lg:flex-col lg:gap-3">{side}</aside>
    </div>
  );
}
