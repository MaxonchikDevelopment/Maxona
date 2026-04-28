export type SessionForEnergy = {
  intensity: string;
  durationMin: number;
  notes: string | null;
};

export type NutritionProfileForEnergy = {
  bodyWeightKg?: number | null;
  estimatedRestDayCalories?: number | null;
  calorieGoal?: string | null;
};

export type DayEnergyEstimate = {
  passiveCalories: number;
  activeCalories: number;
  targetCalories: number;
  balanceNote: string;
};

function metForSession(intensity: string, notes: string | null): number {
  const n = (notes ?? "").toLowerCase();
  const isSwim = n.includes("swim");
  const isCycl = n.includes("cycl") || n.includes("bike") || n.includes("ride");
  const isStrength = n.includes("strength") || n.includes("weight") || n.includes("gym");
  const isHybrid = n.includes("hyrox") || n.includes("hybrid") || n.includes("circuit");

  if (isSwim) {
    if (intensity === "hard") return 9;
    if (intensity === "moderate") return 7;
    return 6;
  }
  if (isCycl) {
    if (intensity === "hard") return 9;
    if (intensity === "moderate") return 7;
    return 5;
  }
  if (isStrength) {
    if (intensity === "hard") return 7;
    if (intensity === "moderate") return 6;
    return 5;
  }
  if (isHybrid) {
    if (intensity === "hard") return 10;
    return 8;
  }
  // Default: running
  if (intensity === "hard") return 11;
  if (intensity === "moderate") return 9;
  return 7;
}

function round25(kcal: number): number {
  return Math.round(kcal / 25) * 25;
}

function round50(kcal: number): number {
  return Math.round(kcal / 50) * 50;
}

export function estimateSessionCalories(
  session: SessionForEnergy,
  bodyWeightKg: number
): number {
  const met = metForSession(session.intensity, session.notes);
  const raw = (met * 3.5 * bodyWeightKg) / 200 * session.durationMin;
  return round25(raw);
}

export function estimateDayEnergy(input: {
  sessions: SessionForEnergy[];
  nutritionProfile: NutritionProfileForEnergy | null | undefined;
}): DayEnergyEstimate | null {
  const p = input.nutritionProfile;
  if (!p?.estimatedRestDayCalories) return null;

  const passiveCalories = p.estimatedRestDayCalories;
  const bw = p.bodyWeightKg;

  let activeCalories = 0;
  if (bw && bw > 0) {
    for (const s of input.sessions) {
      activeCalories += estimateSessionCalories(s, bw);
    }
  }

  const goal = p.calorieGoal ?? "maintain";
  let adjustment = 0;
  if (goal === "slight_surplus") adjustment = 200;
  if (goal === "slight_deficit") adjustment = -200;

  const rawTarget = passiveCalories + activeCalories + adjustment;
  const targetCalories = round50(rawTarget);

  let balanceNote = "";
  if (goal === "slight_surplus") balanceNote = "Slight surplus — supporting adaptation";
  else if (goal === "slight_deficit") balanceNote = "Slight deficit — gradual cut";
  else balanceNote = activeCalories >= 500 ? "Maintenance with high training demand" : "Maintenance day";

  return { passiveCalories, activeCalories, targetCalories, balanceNote };
}
