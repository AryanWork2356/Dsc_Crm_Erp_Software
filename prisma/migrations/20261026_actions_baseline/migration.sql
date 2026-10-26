-- CreateEnum
CREATE TYPE "ActionSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ActionStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "baselineEndDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ProjectTask" ADD COLUMN     "baselineDue" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ActionItem" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "severity" "ActionSeverity" NOT NULL DEFAULT 'MEDIUM',
    "status" "ActionStatus" NOT NULL DEFAULT 'OPEN',
    "ownerId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "projectId" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "sourceLabel" TEXT,
    "link" TEXT,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DateChange" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "projectId" TEXT,
    "field" TEXT NOT NULL,
    "oldDate" TIMESTAMP(3),
    "newDate" TIMESTAMP(3),
    "reason" TEXT NOT NULL,
    "changedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DateChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActionItem_companyId_status_dueDate_idx" ON "ActionItem"("companyId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "ActionItem_projectId_idx" ON "ActionItem"("projectId");

-- CreateIndex
CREATE INDEX "ActionItem_ownerId_status_idx" ON "ActionItem"("ownerId", "status");

-- CreateIndex
CREATE INDEX "ActionItem_companyId_sourceType_sourceId_idx" ON "ActionItem"("companyId", "sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "ActionItem_companyId_number_key" ON "ActionItem"("companyId", "number");

-- CreateIndex
CREATE INDEX "DateChange_entityType_entityId_idx" ON "DateChange"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "DateChange_projectId_idx" ON "DateChange"("projectId");

