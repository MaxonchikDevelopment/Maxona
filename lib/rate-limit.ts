const store = new Map<string, number>();

export function checkCooldown(
  key: string,
  minIntervalMs: number
): { allowed: boolean; retryAfterSec: number } {
  const last = store.get(key) ?? 0;
  const now = Date.now();
  const elapsed = now - last;
  if (elapsed < minIntervalMs) {
    return { allowed: false, retryAfterSec: Math.ceil((minIntervalMs - elapsed) / 1000) };
  }
  store.set(key, now);
  return { allowed: true, retryAfterSec: 0 };
}
