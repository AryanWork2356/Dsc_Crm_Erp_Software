-- Materials needed by the project schedule, with a day-by-day need date; and how early to warn when nothing has been asked for
ALTER TABLE "CompanySettings" ADD COLUMN "materialWarnDays" INTEGER NOT NULL DEFAULT 7;

CREATE TABLE "MaterialNeed" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "materialId" TEXT,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'nos',
    "quantity" DECIMAL(12,3) NOT NULL,
    "neededBy" DATE NOT NULL,
    "taskId" TEXT,
    "forWork" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MaterialNeed_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MaterialNeed_companyId_projectId_neededBy_idx" ON "MaterialNeed"("companyId", "projectId", "neededBy");
CREATE INDEX "MaterialNeed_companyId_neededBy_idx" ON "MaterialNeed"("companyId", "neededBy");
ALTER TABLE "MaterialNeed" ADD CONSTRAINT "MaterialNeed_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
