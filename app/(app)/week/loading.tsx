export default function WeekLoading() {
  return (
    <main className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Week</h1>
      </div>
      <div className="h-20 rounded border bg-gray-50 animate-pulse" />
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-1">
            <div className="h-4 w-24 rounded bg-gray-100 animate-pulse" />
            <div className="h-16 rounded border bg-gray-50 animate-pulse" />
          </div>
        ))}
      </div>
    </main>
  );
}
