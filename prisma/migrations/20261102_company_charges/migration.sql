-- Company profit page: costs that sit below EBITDA (depreciation, interest, income tax), entered by month
CREATE TABLE "CompanyCharge" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CompanyCharge_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CompanyCharge_companyId_year_month_kind_key" ON "CompanyCharge"("companyId", "year", "month", "kind");
CREATE INDEX "CompanyCharge_companyId_year_idx" ON "CompanyCharge"("companyId", "year");
