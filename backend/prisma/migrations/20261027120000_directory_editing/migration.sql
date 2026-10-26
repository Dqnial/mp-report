-- CreateEnum
CREATE TYPE "Potential" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "editedAt" TIMESTAMP(3),
ADD COLUMN     "hiddenFromBase" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "potential" "Potential",
ADD COLUMN     "potentialDate" DATE;

-- AlterTable
ALTER TABLE "places" ADD COLUMN     "hiddenFromBase" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "visits" ADD COLUMN     "fileEditedAt" TIMESTAMP(3),
ADD COLUMN     "potential" "Potential";
