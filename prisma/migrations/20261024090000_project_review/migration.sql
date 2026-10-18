-- CreateTable
CREATE TABLE "ProjectReview" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "evaluatedById" TEXT NOT NULL,
    "clientRating" INTEGER,
    "delayReason" TEXT,
    "delayInControl" BOOLEAN,
    "reworkRequired" BOOLEAN NOT NULL DEFAULT false,
    "snagClosedOnTime" BOOLEAN NOT NULL DEFAULT true,
    "labourDiscipline" BOOLEAN NOT NULL DEFAULT true,
    "wastageControlled" BOOLEAN NOT NULL DEFAULT true,
    "safetyFollowed" BOOLEAN NOT NULL DEFAULT true,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectReview_projectId_key" ON "ProjectReview"("projectId");

-- CreateIndex
CREATE INDEX "ProjectReview_companyId_idx" ON "ProjectReview"("companyId");

-- AddForeignKey
ALTER TABLE "ProjectReview" ADD CONSTRAINT "ProjectReview_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

