import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const USER_ID = "user_maxon";

export async function GET() {
  const profile = await prisma.nutritionProfile.findUnique({
    where: { userId: USER_ID },
  });
  return NextResponse.json(profile ?? null);
}

export async function PATCH(req: Request) {
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
    where: { userId: USER_ID },
    create: { userId: USER_ID, ...data },
    update: data,
  });

  return NextResponse.json(profile);
}
