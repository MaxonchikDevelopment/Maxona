export default function WeekLoading() {
  return (
    <main className="px-4 pt-6 pb-24 space-y-4">
      <div className="h-20 rounded-2xl bg-zinc-100 animate-pulse" />
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <div className="h-4 w-24 rounded-full bg-zinc-100 animate-pulse" />
            <div className="h-16 rounded-2xl bg-zinc-100 animate-pulse" />
          </div>
        ))}
      </div>
    </main>
  );
}
