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

export function DesktopNav() {
  const pathname = usePathname();
  return (
    <nav className="hidden lg:flex items-center gap-1 sticky top-0 z-40 border-b border-zinc-100 bg-white/90 backdrop-blur-sm px-6 xl:px-8 py-2.5">
      <div className="flex items-center gap-0.5">
        {NAV_ITEMS.map(({ href, label }) => {
          const isActive = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`relative px-3 py-1.5 rounded-lg text-sm font-medium transition-colors duration-150 ${
                isActive
                  ? "bg-zinc-100 text-zinc-900"
                  : "text-zinc-500 hover:text-zinc-800 hover:bg-zinc-50"
              }`}
            >
              {isActive && (
                <span className="absolute left-1/2 -translate-x-1/2 -bottom-[13px] h-[2px] w-4 rounded-t-full bg-zinc-800" />
              )}
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
