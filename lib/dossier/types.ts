export type AthleteDossierFacts = {
  maxHr?: number;
  maxHrSource?: string;
  maxHrComputedAt?: string;
  maxHrCandidateCount?: number;
  lthrEstimate?: number;
  lthrSource?: string;
  lthrComputedAt?: string;
  lthrCandidateCount?: number;
  weightKg?: number;
  unavailablePatterns?: string[];
  failureHistory?: { date: string; cause: string }[];
  gear?: Record<string, string>;
  protocols?: {
    name: string;
    adoptedAt: string;
    rule: string;
    rationale: string;
  }[];
};
