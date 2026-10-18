-- CreateEnum
CREATE TYPE "TransferKind" AS ENUM ('MATERIAL', 'MANPOWER');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "CompanySettings" ADD COLUMN     "materialNoticeDays" INTEGER NOT NULL DEFAULT 2;

-- AlterTable
ALTER TABLE "MaterialReceipt" ADD COLUMN     "challanDocId" TEXT;

-- AlterTable
ALTER TABLE "PurchaseRequest" ADD COLUMN     "shortNotice" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "TransferRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "kind" "TransferKind" NOT NULL,
    "fromProjectId" TEXT NOT NULL,
    "toProjectId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "reason" TEXT,
    "items" JSONB NOT NULL,
    "emergency" BOOLEAN NOT NULL DEFAULT false,
    "status" "TransferStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransferRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TransferRequest_companyId_status_idx" ON "TransferRequest"("companyId", "status");

-- CreateIndex
CREATE INDEX "TransferRequest_companyId_fromProjectId_idx" ON "TransferRequest"("companyId", "fromProjectId");

-- CreateIndex
CREATE UNIQUE INDEX "TransferRequest_companyId_number_key" ON "TransferRequest"("companyId", "number");

