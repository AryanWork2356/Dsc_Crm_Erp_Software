-- CreateEnum
CREATE TYPE "ClientPoStatus" AS ENUM ('OPEN', 'CLOSED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "clientPoId" TEXT,
ADD COLUMN     "overPoNote" TEXT;

-- CreateTable
CREATE TABLE "ClientPO" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "poDate" DATE,
    "amount" DECIMAL(14,2) NOT NULL,
    "scopes" TEXT,
    "projectId" TEXT,
    "quotationId" TEXT,
    "documentId" TEXT,
    "status" "ClientPoStatus" NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientPO_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionNote" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'CALL',
    "note" TEXT NOT NULL,
    "promisedAmount" DECIMAL(14,2),
    "promisedDate" DATE,
    "nextAction" TEXT,
    "nextActionDate" DATE,
    "ownerId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectionNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientPO_companyId_status_idx" ON "ClientPO"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ClientPO_companyId_clientId_number_key" ON "ClientPO"("companyId", "clientId", "number");

-- CreateIndex
CREATE INDEX "CollectionNote_invoiceId_createdAt_idx" ON "CollectionNote"("invoiceId", "createdAt");

-- CreateIndex
CREATE INDEX "CollectionNote_companyId_nextActionDate_idx" ON "CollectionNote"("companyId", "nextActionDate");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_clientPoId_fkey" FOREIGN KEY ("clientPoId") REFERENCES "ClientPO"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientPO" ADD CONSTRAINT "ClientPO_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

