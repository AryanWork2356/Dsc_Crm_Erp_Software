-- AlterTable
ALTER TABLE "Boq" ADD COLUMN     "clientId" TEXT,
ADD COLUMN     "profitPct" DECIMAL(6,2),
ADD COLUMN     "ratesAppliedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ClientRateCard" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "profitPct" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientRateCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientRate" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'nos',
    "category" "BoqCategory" NOT NULL DEFAULT 'OTHER',
    "materialRate" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "labourRate" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "otherRate" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientRateCard_clientId_key" ON "ClientRateCard"("clientId");

-- CreateIndex
CREATE INDEX "ClientRateCard_companyId_idx" ON "ClientRateCard"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientRate_cardId_nameKey_unit_key" ON "ClientRate"("cardId", "nameKey", "unit");

-- AddForeignKey
ALTER TABLE "ClientRateCard" ADD CONSTRAINT "ClientRateCard_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientRate" ADD CONSTRAINT "ClientRate_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "ClientRateCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Boq" ADD CONSTRAINT "Boq_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

