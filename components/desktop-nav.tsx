"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";

const NAV_ITEMS = [
  { href: "/today", label: "Today" },
  { href: "/week", label: "Week" },
  { href: "/review", label: "Review" },
  { href: "/goals", label: "Goals" },
  { href: "/settings", label: "Settings" },
];

export function DesktopNav() {
  const pathname = usePathname();
  return (
    <nav className="hidden lg:block sticky top-0 z-40 px-6 xl:px-8 py-3">
      <div className="flex items-center gap-0.5 w-fit rounded-2xl bg-white/60 backdrop-blur-md border border-zinc-100/80 shadow-sm px-3 py-1.5">
        {NAV_ITEMS.map(({ href, label }) => {
          const isActive = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`relative px-3 py-1.5 rounded-xl text-sm font-medium transition-colors duration-150 ${
                isActive
                  ? "bg-white/80 text-zinc-900 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-800 hover:bg-white/50"
              }`}
            >
              {isActive && (
                <motion.span
                  layoutId="desktop-nav-indicator"
                  className="absolute left-1/2 -translate-x-1/2 bottom-0.5 h-[2px] w-4 rounded-t-full bg-zinc-800"
                  transition={{ type: "tween", duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
                />
              )}
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
