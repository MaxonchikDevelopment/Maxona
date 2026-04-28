-- AlterTable
ALTER TABLE "NutritionProfile" ADD COLUMN     "bodyWeightKg" DOUBLE PRECISION,
ADD COLUMN     "calorieGoal" TEXT,
ADD COLUMN     "estimatedRestDayCalories" INTEGER;
