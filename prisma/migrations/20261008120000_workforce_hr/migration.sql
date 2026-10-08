-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "rejectedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Leave" ADD COLUMN     "decidedById" TEXT,
ADD COLUMN     "decisionNote" TEXT,
ADD COLUMN     "paid" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "WorkOrder" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "projectId" TEXT,
    "title" TEXT NOT NULL,
    "scope" TEXT,
    "rateNote" TEXT,
    "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractorPayment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "workOrderId" TEXT,
    "projectId" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'BANK_TRANSFER',
    "reference" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractorPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkOrder_companyId_contractorId_idx" ON "WorkOrder"("companyId", "contractorId");

-- CreateIndex
CREATE INDEX "WorkOrder_companyId_projectId_idx" ON "WorkOrder"("companyId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrder_companyId_number_key" ON "WorkOrder"("companyId", "number");

-- CreateIndex
CREATE INDEX "ContractorPayment_companyId_date_idx" ON "ContractorPayment"("companyId", "date");

-- CreateIndex
CREATE INDEX "ContractorPayment_companyId_projectId_idx" ON "ContractorPayment"("companyId", "projectId");

-- CreateIndex
CREATE INDEX "Announcement_companyId_createdAt_idx" ON "Announcement"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_employeeId_date_key" ON "Attendance"("employeeId", "date");

-- CreateIndex
CREATE INDEX "Leave_employeeId_fromDate_idx" ON "Leave"("employeeId", "fromDate");

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractorPayment" ADD CONSTRAINT "ContractorPayment_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractorPayment" ADD CONSTRAINT "ContractorPayment_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

