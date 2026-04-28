export function normalizeCoachBullets(text: string): string {
  let s = text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\r\n/g, "\n");

  // Push any mid-line bullet onto its own line ("• A. • B." → "• A.\n• B.")
  s = s.replace(/\s+(•)/g, "\n$1");

  const bullets = s
    .split("\n")
    .map((b) => b.trim())
    .filter((b) => b.length > 0)
    .map((b) => (b.startsWith("•") ? b : `• ${b.replace(/^[-]\s*/, "")}`))
    .slice(0, 4);

  return bullets.join("\n\n");
}

export function stripMarkdownBold(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1");
}
