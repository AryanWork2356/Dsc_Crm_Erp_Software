-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN     "accuracyM" INTEGER,
ADD COLUMN     "distanceM" INTEGER;

-- AlterTable
ALTER TABLE "CompanySettings" ADD COLUMN     "geoRadiusM" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "geoRequired" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "officeLat" DOUBLE PRECISION,
ADD COLUMN     "officeLng" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "geoRadiusM" INTEGER,
ADD COLUMN     "siteLat" DOUBLE PRECISION,
ADD COLUMN     "siteLng" DOUBLE PRECISION;

