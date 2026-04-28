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
  };

  const data = {
    dietNotes: body.dietNotes ?? null,
    avoidFoods: body.avoidFoods ?? null,
    preferredBreakfast: body.preferredBreakfast ?? null,
    preferredPreWorkoutSnack: body.preferredPreWorkoutSnack ?? null,
    preferredPostWorkoutMeal: body.preferredPostWorkoutMeal ?? null,
    caffeineSensitive: body.caffeineSensitive ?? false,
    stomachSensitive: body.stomachSensitive ?? false,
  };

  const profile = await prisma.nutritionProfile.upsert({
    where: { userId: USER_ID },
    create: { userId: USER_ID, ...data },
    update: data,
  });

  return NextResponse.json(profile);
}
