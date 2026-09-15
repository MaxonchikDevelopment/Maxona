import { z } from "zod";

export const athleteDossierFactsSchema = z.object({
  maxHr: z.number().optional(),
  maxHrSource: z.string().optional(),
  maxHrComputedAt: z.string().optional(),
  maxHrCandidateCount: z.number().optional(),
  lthrEstimate: z.number().optional(),
  lthrSource: z.string().optional(),
  lthrComputedAt: z.string().optional(),
  lthrCandidateCount: z.number().optional(),
  weightKg: z.number().optional(),
  unavailablePatterns: z.array(z.string()).optional(),
  failureHistory: z
    .array(
      z.object({
        date: z.string(),
        cause: z.string(),
      }),
    )
    .optional(),
  gear: z.record(z.string(), z.string()).optional(),
  protocols: z
    .array(
      z.object({
        name: z.string(),
        adoptedAt: z.string(),
        rule: z.string(),
        rationale: z.string(),
      }),
    )
    .optional(),
});
