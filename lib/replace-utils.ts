// Encodes a "replaced" session into TrainingSession.notes so no schema change is needed.
// A replaced session is stored as status=skipped (the planned session didn't happen)
// with notes carrying a recognizable prefix the UI can parse back out.
const REPLACED_PREFIX = "REPLACED:: ";
const REASON_SEPARATOR = " — reason: ";
const AI_SEPARATOR = "\n\nAI check: ";

export interface ParsedReplacement {
  description: string;
  reason: string | null;
  aiNote: string | null;
}

export function buildReplacedNotes(input: {
  description: string;
  reason?: string | null;
  aiNote?: string | null;
}): string {
  const reasonPart = input.reason ? `${REASON_SEPARATOR}${input.reason}` : "";
  const aiPart = input.aiNote ? `${AI_SEPARATOR}${input.aiNote}` : "";
  return `${REPLACED_PREFIX}${input.description}${reasonPart}${aiPart}`;
}

export function parseReplacedNotes(notes: string | null): ParsedReplacement | null {
  if (!notes || !notes.startsWith(REPLACED_PREFIX)) return null;
  const body = notes.slice(REPLACED_PREFIX.length);
  const [mainPart, aiNote] = body.split(AI_SEPARATOR);
  const reasonIdx = mainPart.indexOf(REASON_SEPARATOR);
  if (reasonIdx === -1) {
    return { description: mainPart, reason: null, aiNote: aiNote ?? null };
  }
  return {
    description: mainPart.slice(0, reasonIdx),
    reason: mainPart.slice(reasonIdx + REASON_SEPARATOR.length),
    aiNote: aiNote ?? null,
  };
}
