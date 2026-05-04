"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/today", label: "Today" },
  { href: "/week", label: "Week" },
  { href: "/review", label: "Plan" },
  { href: "/goals", label: "Goals" },
  { href: "/settings", label: "Settings" },
];

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-zinc-100 bg-white/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-md">
        {NAV_ITEMS.map(({ href, label }) => {
          const isActive = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`relative flex flex-1 flex-col items-center pt-2.5 pb-3 text-[11px] font-medium transition-colors duration-150 ${
                isActive ? "text-zinc-900" : "text-zinc-400 hover:text-zinc-600"
              }`}
            >
              {isActive && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 h-[2px] w-5 rounded-b-full bg-zinc-900" />
              )}
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
