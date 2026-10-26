-- CreateEnum
CREATE TYPE "VendorTier" AS ENUM ('PRIMARY', 'BACKUP', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "FeasibilityDecision" AS ENUM ('PENDING', 'ACCEPT', 'ACCEPT_WITH_CONDITIONS', 'RENEGOTIATE_OR_DECLINE');

-- CreateEnum
CREATE TYPE "CheckStatus" AS ENUM ('PENDING', 'CONFIRMED', 'AT_RISK', 'NOT_NEEDED');

-- CreateEnum
CREATE TYPE "ChecklistKind" AS ENUM ('FEASIBILITY', 'LAUNCH');

-- AlterTable
ALTER TABLE "CompanySettings" ADD COLUMN     "resourceCoordinatorId" TEXT;

-- AlterTable
ALTER TABLE "ProjectTask" ADD COLUMN     "actualQty" DECIMAL(12,3),
ADD COLUMN     "blockedReason" TEXT,
ADD COLUMN     "plannedQty" DECIMAL(12,3),
ADD COLUMN     "qtyUnit" TEXT,
ADD COLUMN     "releasedAt" TIMESTAMP(3),
ADD COLUMN     "requiredHeadcount" INTEGER,
ADD COLUMN     "requiredTrade" TEXT,
ADD COLUMN     "zone" TEXT,
ADD COLUMN     "zoneReleased" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "crewSize" INTEGER,
ADD COLUMN     "tier" "VendorTier" NOT NULL DEFAULT 'PRIMARY',
ADD COLUMN     "trades" TEXT;

-- CreateTable
CREATE TABLE "ResourceNeed" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "trade" TEXT NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "required" INTEGER NOT NULL,
    "confirmed" INTEGER NOT NULL DEFAULT 0,
    "vendorId" TEXT,
    "backupVendorId" TEXT,
    "confirmedNote" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResourceNeed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManpowerLog" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "trade" TEXT NOT NULL,
    "planned" INTEGER NOT NULL,
    "present" INTEGER NOT NULL,
    "late" INTEGER NOT NULL DEFAULT 0,
    "vendorId" TEXT,
    "reason" TEXT,
    "replacement" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManpowerLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feasibility" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "quotationId" TEXT,
    "projectId" TEXT,
    "decision" "FeasibilityDecision" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "note" TEXT,
    "exceptionNote" TEXT,
    "exceptionApproverId" TEXT,
    "resolveBy" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Feasibility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistItem" (
    "id" TEXT NOT NULL,
    "feasibilityId" TEXT NOT NULL,
    "kind" "ChecklistKind" NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "question" TEXT,
    "status" "CheckStatus" NOT NULL DEFAULT 'PENDING',
    "ownerId" TEXT,
    "dueDate" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" TEXT,
    "evidence" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResourceNeed_companyId_fromDate_idx" ON "ResourceNeed"("companyId", "fromDate");

-- CreateIndex
CREATE INDEX "ResourceNeed_projectId_trade_idx" ON "ResourceNeed"("projectId", "trade");

-- CreateIndex
CREATE INDEX "ManpowerLog_companyId_date_idx" ON "ManpowerLog"("companyId", "date");

-- CreateIndex
CREATE INDEX "ManpowerLog_vendorId_date_idx" ON "ManpowerLog"("vendorId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ManpowerLog_projectId_date_trade_key" ON "ManpowerLog"("projectId", "date", "trade");

-- CreateIndex
CREATE UNIQUE INDEX "Feasibility_quotationId_key" ON "Feasibility"("quotationId");

-- CreateIndex
CREATE UNIQUE INDEX "Feasibility_projectId_key" ON "Feasibility"("projectId");

-- CreateIndex
CREATE INDEX "Feasibility_companyId_idx" ON "Feasibility"("companyId");

-- CreateIndex
CREATE INDEX "ChecklistItem_feasibilityId_idx" ON "ChecklistItem"("feasibilityId");

-- CreateIndex
CREATE UNIQUE INDEX "ChecklistItem_feasibilityId_kind_key_key" ON "ChecklistItem"("feasibilityId", "kind", "key");

-- AddForeignKey
ALTER TABLE "ResourceNeed" ADD CONSTRAINT "ResourceNeed_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManpowerLog" ADD CONSTRAINT "ManpowerLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feasibility" ADD CONSTRAINT "Feasibility_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistItem" ADD CONSTRAINT "ChecklistItem_feasibilityId_fkey" FOREIGN KEY ("feasibilityId") REFERENCES "Feasibility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

