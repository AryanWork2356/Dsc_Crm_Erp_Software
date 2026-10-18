-- CreateEnum
CREATE TYPE "AdditionalWorkStatus" AS ENUM ('DRAFT', 'SENT', 'APPROVED', 'REJECTED', 'IN_PROGRESS', 'COMPLETED');

-- AlterTable
ALTER TABLE "VendorBill" ADD COLUMN     "certNote" TEXT,
ADD COLUMN     "certRequired" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "certifiedAt" TIMESTAMP(3),
ADD COLUMN     "certifiedById" TEXT;

-- CreateTable
CREATE TABLE "AdditionalWork" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "AdditionalWorkStatus" NOT NULL DEFAULT 'DRAFT',
    "requestedById" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decidedByName" TEXT,
    "decisionVia" TEXT,
    "decisionNote" TEXT,
    "approvalDocId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdditionalWork_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdditionalWork_companyId_projectId_idx" ON "AdditionalWork"("companyId", "projectId");

-- CreateIndex
CREATE INDEX "AdditionalWork_companyId_status_idx" ON "AdditionalWork"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AdditionalWork_companyId_number_key" ON "AdditionalWork"("companyId", "number");

-- AddForeignKey
ALTER TABLE "AdditionalWork" ADD CONSTRAINT "AdditionalWork_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Bills recorded before this rule existed keep working without certification
UPDATE "VendorBill" SET "certRequired" = false;
