-- AlterTable
ALTER TABLE "NutritionProfile" ADD COLUMN     "cookingTimePreference" TEXT,
ADD COLUMN     "currentMealPattern" TEXT,
ADD COLUMN     "minHoursAfterMainMealBeforeWorkout" INTEGER,
ADD COLUMN     "nutritionGoal" TEXT,
ADD COLUMN     "preWorkoutSnackTolerance" TEXT,
ADD COLUMN     "preferredFoods" TEXT,
ADD COLUMN     "supplements" TEXT;
