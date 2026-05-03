export async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (process.env.NODE_ENV === "production") return fn();
  const start = Date.now();
  try {
    return await fn();
  } finally {
    console.log(`[perf] ${label}: ${Date.now() - start}ms`);
  }
}
