export type AthleteDossierFacts = {
  maxHr?: number;
  lthrEstimate?: number;
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
