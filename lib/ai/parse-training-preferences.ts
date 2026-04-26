import Anthropic from "@anthropic-ai/sdk";
import type { ParsedPreferences } from "@/lib/ai/adapter";
import { parseTrainingPreferences as parseRegex } from "@/lib/planner/preference-constraints";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const VALID_DAYS = new Set(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]);
const VALID_MODALITIES = new Set(["hyrox", "running", "cycling", "swimming"]);
const VALID_INTENSITY = new Set(["easy", "moderate", "hard"]);
const VALID_SLOTS = new Set(["morning", "daytime", "afternoon", "evening"]);

function validateParsed(raw: unknown): ParsedPreferences {
  const empty = (): ParsedPreferences => ({
    explicitDayRequests: [],
    desiredModalities: [],
    sacrificedModalities: [],
  });

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return empty();
  const r = raw as Record<string, unknown>;

  const explicitDayRequests = (Array.isArray(r.explicitDayRequests) ? r.explicitDayRequests : [])
    .filter((x: unknown): x is Record<string, unknown> => !!x && typeof x === "object")
    .filter(e => VALID_DAYS.has(String(e.day).toLowerCase()) && VALID_MODALITIES.has(String(e.modality).toLowerCase()))
    .map(e => ({
      day: String(e.day).toLowerCase(),
      modality: String(e.modality).toLowerCase(),
      ...(e.intensityHint && VALID_INTENSITY.has(String(e.intensityHint).toLowerCase()) ? { intensityHint: String(e.intensityHint).toLowerCase() } : {}),
      ...(e.slotHint && VALID_SLOTS.has(String(e.slotHint).toLowerCase()) ? { slotHint: String(e.slotHint).toLowerCase() } : {}),
    }));

  const desiredModalities = (Array.isArray(r.desiredModalities) ? r.desiredModalities : [])
    .filter((x: unknown): x is Record<string, unknown> => !!x && typeof x === "object")
    .filter(e => VALID_MODALITIES.has(String(e.modality).toLowerCase()) && typeof e.minCount === "number" && (e.minCount as number) >= 0)
    .map(e => ({
      modality: String(e.modality).toLowerCase(),
      minCount: Number(e.minCount),
      ...(typeof e.maxCount === "number" && (e.maxCount as number) > 0 ? { maxCount: Number(e.maxCount) } : {}),
      ...(e.intensityHint && VALID_INTENSITY.has(String(e.intensityHint).toLowerCase()) ? { intensityHint: String(e.intensityHint).toLowerCase() } : {}),
      ...(e.preferredSlot && VALID_SLOTS.has(String(e.preferredSlot).toLowerCase()) ? { preferredSlot: String(e.preferredSlot).toLowerCase() } : {}),
      ...(Array.isArray(e.preferredDays) ? {
        preferredDays: (e.preferredDays as unknown[]).map(String).map(d => d.toLowerCase()).filter(d => VALID_DAYS.has(d)),
      } : {}),
    }));

  const sacrificedModalities = (Array.isArray(r.sacrificedModalities) ? r.sacrificedModalities : [])
    .map((x: unknown) => String(x).toLowerCase())
    .filter(m => VALID_MODALITIES.has(m));

  const availabilityHints = Array.isArray(r.availabilityHints)
    ? (r.availabilityHints as unknown[])
        .filter((x: unknown): x is Record<string, unknown> => !!x && typeof x === "object")
        .filter(e => VALID_DAYS.has(String(e.day).toLowerCase()) && Array.isArray(e.blockedSlots))
        .map(e => ({
          day: String(e.day).toLowerCase(),
          blockedSlots: (e.blockedSlots as unknown[]).map(String).map(s => s.toLowerCase()).filter(s => VALID_SLOTS.has(s)),
        }))
        .filter(h => h.blockedSlots.length > 0)
    : undefined;

  return {
    explicitDayRequests,
    desiredModalities,
    sacrificedModalities,
    ...(availabilityHints && availabilityHints.length > 0 && { availabilityHints }),
  };
}

export async function parseLLMPreferences(text: string): Promise<ParsedPreferences> {
  const fallback = () => parseRegex(text);

  if (!text.trim()) return fallback();

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      messages: [
        {
          role: "user",
          content: `Extract training scheduling preferences from this athlete's note. The note may be in any language. Return ONLY valid JSON.

Note: ${JSON.stringify(text)}

Output this JSON structure (use empty arrays if nothing applies):
{
  "explicitDayRequests": [
    { "day": "<day>", "modality": "<modality>", "intensityHint": "<intensity>", "slotHint": "<slot>" }
  ],
  "desiredModalities": [
    { "modality": "<modality>", "minCount": 1, "maxCount": 1, "intensityHint": "<intensity>", "preferredSlot": "<slot>" }
  ],
  "sacrificedModalities": ["<modality>"],
  "availabilityHints": [
    { "day": "<day>", "blockedSlots": ["<slot>"] }
  ]
}

Allowed values:
- day: monday, tuesday, wednesday, thursday, friday, saturday, sunday
- modality: hyrox, running, cycling, swimming (only these four)
- intensityHint / slotHint / preferredSlot: easy|moderate|hard or morning|daytime|afternoon|evening (omit if not stated)
- maxCount: set only when athlete says "one X" or "just one X" or "a single X" (set to 1)

Extraction rules:
- "HYROX on Monday and Wednesday" → two explicitDayRequests: [{day:monday,modality:hyrox},{day:wednesday,modality:hyrox}]
- "one easy bike ride" → desiredModalities: [{modality:cycling, minCount:1, maxCount:1, intensityHint:easy}]
- "swimming can be sacrificed / skipped / dropped" → sacrificedModalities: ["swimming"]
- "Wednesday morning is blocked / unavailable" → availabilityHints: [{day:wednesday, blockedSlots:["morning"]}]
- "focus on running" → desiredModalities: [{modality:running, minCount:2}] (at least 2 running sessions)
- "available evenings on weekdays, mornings on weekends" → NOT an explicit request (handled by system); skip
- Only extract what is clearly stated. Return empty arrays for fields with no matches.

Return JSON only. No explanation. No markdown.`,
        },
      ],
    });

    const block = response.content.find(b => b.type === "text");
    if (!block || block.type !== "text") {
      console.log("[parse-training-preferences] no text block, using regex fallback");
      return fallback();
    }

    const jsonMatch = block.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.log("[parse-training-preferences] no JSON in response, using regex fallback");
      return fallback();
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const validated = validateParsed(parsed);

    if (process.env.NODE_ENV !== "production") {
      console.log("[parse-training-preferences] LLM result:", JSON.stringify(validated));
    }

    return validated;
  } catch (err) {
    console.error("[parse-training-preferences] LLM parse failed, using regex fallback:", err);
    return fallback();
  }
}
