export default function TodayLoading() {
  return (
    <main className="p-4 space-y-3">
      <h1 className="text-xl font-bold">Today</h1>
      <div className="h-16 rounded border bg-gray-50 animate-pulse" />
      <div className="space-y-3">
        <div className="h-28 rounded border bg-gray-50 animate-pulse" />
        <div className="h-28 rounded border bg-gray-50 animate-pulse" />
      </div>
    </main>
  );
}
