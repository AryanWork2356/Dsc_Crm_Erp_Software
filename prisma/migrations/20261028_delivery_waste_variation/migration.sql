-- CreateEnum
CREATE TYPE "DelayReason" AS ENUM ('DSC_LATE_REQUEST', 'SUPPLIER_DELAY', 'TRANSPORT', 'SPEC_CHANGE', 'SITE_ACCESS', 'OTHER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ExtraKind" AS ENUM ('CHARGEABLE', 'INCLUDED', 'EMERGENCY', 'OWN_REWORK', 'CONCESSION');

-- CreateEnum
CREATE TYPE "WasteKind" AS ENUM ('WASTE', 'DAMAGED', 'SUPPLIER_DAMAGE', 'REWORK', 'OFFCUT_REUSABLE');

-- AlterTable
ALTER TABLE "AdditionalWork" ADD COLUMN     "billedInvoiceId" TEXT,
ADD COLUMN     "costEstimate" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "inOriginalScope" BOOLEAN,
ADD COLUMN     "internalApprovedAt" TIMESTAMP(3),
ADD COLUMN     "internalApprovedById" TEXT,
ADD COLUMN     "internalNote" TEXT,
ADD COLUMN     "kind" "ExtraKind" NOT NULL DEFAULT 'CHARGEABLE',
ADD COLUMN     "scheduleImpactDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "scopeNote" TEXT,
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedById" TEXT,
ADD COLUMN     "verifyNote" TEXT;

-- AlterTable
ALTER TABLE "PurchaseOrderItem" ADD COLUMN     "delayReason" "DelayReason",
ADD COLUMN     "needBy" TIMESTAMP(3),
ADD COLUMN     "promisedEta" TIMESTAMP(3),
ADD COLUMN     "recoveryNote" TEXT;

-- CreateTable
CREATE TABLE "MaterialWaste" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT,
    "materialId" TEXT NOT NULL,
    "locationId" TEXT,
    "kind" "WasteKind" NOT NULL DEFAULT 'WASTE',
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "unitCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "costValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL,
    "ownerId" TEXT,
    "actionNote" TEXT,
    "date" DATE NOT NULL,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialWaste_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaterialWaste_companyId_date_idx" ON "MaterialWaste"("companyId", "date");

-- CreateIndex
CREATE INDEX "MaterialWaste_projectId_materialId_idx" ON "MaterialWaste"("projectId", "materialId");

