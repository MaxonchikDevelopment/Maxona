import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserIdFromRequest } from "@/lib/auth/session";

export async function GET(request: NextRequest) {
  const userId = await getSessionUserIdFromRequest(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const profile = await prisma.nutritionProfile.findUnique({ where: { userId } });
  return NextResponse.json(profile ?? null);
}

export async function PATCH(req: NextRequest) {
  const userId = await getSessionUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as {
    dietNotes?: string | null;
    avoidFoods?: string | null;
    preferredBreakfast?: string | null;
    preferredPreWorkoutSnack?: string | null;
    preferredPostWorkoutMeal?: string | null;
    caffeineSensitive?: boolean;
    stomachSensitive?: boolean;
    currentMealPattern?: string | null;
    nutritionGoal?: string | null;
    minHoursAfterMainMealBeforeWorkout?: number | null;
    preWorkoutSnackTolerance?: string | null;
    preferredFoods?: string | null;
    supplements?: string | null;
    cookingTimePreference?: string | null;
    bodyWeightKg?: number | null;
    estimatedRestDayCalories?: number | null;
    calorieGoal?: string | null;
  };

  const data = {
    dietNotes: body.dietNotes ?? null,
    avoidFoods: body.avoidFoods ?? null,
    preferredBreakfast: body.preferredBreakfast ?? null,
    preferredPreWorkoutSnack: body.preferredPreWorkoutSnack ?? null,
    preferredPostWorkoutMeal: body.preferredPostWorkoutMeal ?? null,
    caffeineSensitive: body.caffeineSensitive ?? false,
    stomachSensitive: body.stomachSensitive ?? false,
    currentMealPattern: body.currentMealPattern ?? null,
    nutritionGoal: body.nutritionGoal ?? null,
    minHoursAfterMainMealBeforeWorkout: body.minHoursAfterMainMealBeforeWorkout ?? null,
    preWorkoutSnackTolerance: body.preWorkoutSnackTolerance ?? null,
    preferredFoods: body.preferredFoods ?? null,
    supplements: body.supplements ?? null,
    cookingTimePreference: body.cookingTimePreference ?? null,
    bodyWeightKg: body.bodyWeightKg ?? null,
    estimatedRestDayCalories: body.estimatedRestDayCalories ?? null,
    calorieGoal: body.calorieGoal ?? null,
  };

  const profile = await prisma.nutritionProfile.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });

  return NextResponse.json(profile);
}
