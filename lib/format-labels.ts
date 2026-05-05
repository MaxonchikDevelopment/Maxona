export function formatIntensity(value: string): string {
  const l = value.toLowerCase();
  if (l === "easy") return "Easy";
  if (l === "moderate") return "Moderate";
  if (l === "hard") return "Hard";
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

export function formatSportLabel(value: string): string {
  const l = value.toLowerCase();
  if (l === "hyrox") return "HYROX";
  if (l.includes("run")) return "Running";
  if (l.includes("ride") || l.includes("cycling") || l.includes("cycle") || l.includes("bike")) return "Cycling";
  if (l.includes("swim")) return "Swimming";
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

export function formatSlot(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}
