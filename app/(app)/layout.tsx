import { BottomNav } from "@/components/bottom-nav";
import { DesktopNav } from "@/components/desktop-nav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto min-h-screen max-w-md lg:max-w-6xl xl:max-w-7xl pb-16 lg:pb-0 lg:pt-14">
      <DesktopNav />
      {children}
      <BottomNav />
    </div>
  );
}
