-- AlterTable
ALTER TABLE "TrainingSession" ADD COLUMN     "distanceKm" DOUBLE PRECISION,
ADD COLUMN     "subtype" TEXT,
ADD COLUMN     "targetHrZoneMax" INTEGER,
ADD COLUMN     "targetHrZoneMin" INTEGER,
ADD COLUMN     "targetPaceMinPerKm" TEXT;

