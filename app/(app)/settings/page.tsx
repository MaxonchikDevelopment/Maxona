import { prisma } from "@/lib/prisma";
import { SettingsClient } from "@/components/settings-client";
import type { StravaConnectionProp } from "@/components/strava-settings";
import type { TrainingProfileProp, HybridProfileProp, NutritionProfileProp } from "@/components/settings-client";

export const dynamic = "force-dynamic";

const USER_ID = "user_maxon";

export default async function SettingsPage() {
  const [user, stravaConn, trainingProfileRaw, hybridProfileRaw, nutritionProfileRaw] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: USER_ID } }),
    prisma.stravaConnection.findUnique({ where: { userId: USER_ID } }),
    prisma.userTrainingProfile.findUnique({ where: { userId: USER_ID } }),
    prisma.hybridRaceProfile.findUnique({ where: { userId: USER_ID } }),
    prisma.nutritionProfile.findUnique({ where: { userId: USER_ID } }),
  ]);

  const stravaConnection: StravaConnectionProp = stravaConn
    ? { stravaAthleteId: stravaConn.stravaAthleteId, createdAt: stravaConn.createdAt.toISOString() }
    : null;

  const trainingProfile: TrainingProfileProp | null = trainingProfileRaw
    ? {
        restingHr: trainingProfileRaw.restingHr,
        maxHr: trainingProfileRaw.maxHr,
        easyHrMin: trainingProfileRaw.easyHrMin,
        easyHrMax: trainingProfileRaw.easyHrMax,
        tempoHrMin: trainingProfileRaw.tempoHrMin,
        tempoHrMax: trainingProfileRaw.tempoHrMax,
        thresholdHr: trainingProfileRaw.thresholdHr,
        zoneMethod: trainingProfileRaw.zoneMethod,
      }
    : null;

  const hybridProfile: HybridProfileProp | null = hybridProfileRaw
    ? {
        defaultFormat: hybridProfileRaw.defaultFormat,
        includesRunningDefault: hybridProfileRaw.includesRunningDefault,
        stationWorkSec: hybridProfileRaw.stationWorkSec,
        stationRestSec: hybridProfileRaw.stationRestSec,
        defaultRounds: hybridProfileRaw.defaultRounds,
        notes: hybridProfileRaw.notes,
      }
    : null;

  const nutritionProfile: NutritionProfileProp | null = nutritionProfileRaw
    ? {
        dietNotes: nutritionProfileRaw.dietNotes,
        avoidFoods: nutritionProfileRaw.avoidFoods,
        preferredBreakfast: nutritionProfileRaw.preferredBreakfast,
        preferredPreWorkoutSnack: nutritionProfileRaw.preferredPreWorkoutSnack,
        preferredPostWorkoutMeal: nutritionProfileRaw.preferredPostWorkoutMeal,
        caffeineSensitive: nutritionProfileRaw.caffeineSensitive,
        stomachSensitive: nutritionProfileRaw.stomachSensitive,
        currentMealPattern: nutritionProfileRaw.currentMealPattern,
        nutritionGoal: nutritionProfileRaw.nutritionGoal,
        minHoursAfterMainMealBeforeWorkout: nutritionProfileRaw.minHoursAfterMainMealBeforeWorkout,
        preWorkoutSnackTolerance: nutritionProfileRaw.preWorkoutSnackTolerance,
        preferredFoods: nutritionProfileRaw.preferredFoods,
        supplements: nutritionProfileRaw.supplements,
        cookingTimePreference: nutritionProfileRaw.cookingTimePreference,
        bodyWeightKg: nutritionProfileRaw.bodyWeightKg,
        estimatedRestDayCalories: nutritionProfileRaw.estimatedRestDayCalories,
        calorieGoal: nutritionProfileRaw.calorieGoal,
      }
    : null;

  return (
    <SettingsClient
      initialConstraints={(user.constraints ?? {}) as Record<string, unknown>}
      userName={user.name}
      userTimezone={user.timezone}
      initialStravaConnection={stravaConnection}
      initialTrainingProfile={trainingProfile}
      initialHybridProfile={hybridProfile}
      initialNutritionProfile={nutritionProfile}
    />
  );
}
