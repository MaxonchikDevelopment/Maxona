"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/today", label: "Today" },
  { href: "/week", label: "Week" },
  { href: "/review", label: "Review" },
  { href: "/goals", label: "Goals" },
  { href: "/settings", label: "Settings" },
];

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed bottom-0 left-0 right-0 flex border-t bg-white">
      {NAV_ITEMS.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          className={`flex flex-1 flex-col items-center py-3 text-xs ${
            pathname === href ? "font-bold text-black" : "text-gray-400"
          }`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
