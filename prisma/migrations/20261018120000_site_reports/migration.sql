-- CreateEnum
CREATE TYPE "ReportKind" AS ENUM ('MORNING', 'EVENING');

-- CreateEnum
CREATE TYPE "SiteMaterialStatus" AS ENUM ('OK', 'SHORT_SOON', 'WORK_STOPPED');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'REPORT_MISSING';

-- AlterTable
ALTER TABLE "CompanySettings" ADD COLUMN     "reportEveningDue" TEXT NOT NULL DEFAULT '19:00',
ADD COLUMN     "reportMorningDue" TEXT NOT NULL DEFAULT '10:00',
ADD COLUMN     "reportMorningDueOutstation" TEXT NOT NULL DEFAULT '09:30';

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "outstation" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "DailyReport" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "reportDate" DATE NOT NULL,
    "kind" "ReportKind" NOT NULL,
    "submittedById" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "onTime" BOOLEAN NOT NULL DEFAULT true,
    "manpower" INTEGER NOT NULL DEFAULT 0,
    "progressPct" INTEGER,
    "workDone" TEXT,
    "planNext" TEXT,
    "materialStatus" "SiteMaterialStatus" NOT NULL DEFAULT 'OK',
    "issues" TEXT,
    "photoIds" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "DailyReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyReport_companyId_reportDate_idx" ON "DailyReport"("companyId", "reportDate");

-- CreateIndex
CREATE INDEX "DailyReport_companyId_submittedById_idx" ON "DailyReport"("companyId", "submittedById");

-- CreateIndex
CREATE UNIQUE INDEX "DailyReport_projectId_reportDate_kind_key" ON "DailyReport"("projectId", "reportDate", "kind");

-- AddForeignKey
ALTER TABLE "DailyReport" ADD CONSTRAINT "DailyReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

