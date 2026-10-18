-- CreateEnum
CREATE TYPE "LeaveKind" AS ENUM ('REGULAR', 'MEDICAL', 'EMERGENCY', 'LONG');

-- CreateEnum
CREATE TYPE "AdvanceStatus" AS ENUM ('OPEN', 'CLEARED', 'WRITTEN_OFF');

-- AlterTable
ALTER TABLE "CompanySettings" ADD COLUMN     "leaveNoticeDays" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN     "leaveYearlyCap" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "longLeaveNoticeDays" INTEGER NOT NULL DEFAULT 90;

-- AlterTable
ALTER TABLE "Leave" ADD COLUMN     "exceedsCap" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "kind" "LeaveKind" NOT NULL DEFAULT 'REGULAR';

-- AlterTable
ALTER TABLE "Payslip" ADD COLUMN     "advanceRecovery" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "EmployeeAdvance" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "givenOn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "monthlyRecovery" DECIMAL(12,2) NOT NULL,
    "status" "AdvanceStatus" NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeAdvance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdvanceRecovery" (
    "id" TEXT NOT NULL,
    "advanceId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdvanceRecovery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployeeAdvance_companyId_status_idx" ON "EmployeeAdvance"("companyId", "status");

-- CreateIndex
CREATE INDEX "EmployeeAdvance_employeeId_idx" ON "EmployeeAdvance"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "AdvanceRecovery_advanceId_month_year_key" ON "AdvanceRecovery"("advanceId", "month", "year");

-- AddForeignKey
ALTER TABLE "EmployeeAdvance" ADD CONSTRAINT "EmployeeAdvance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvanceRecovery" ADD CONSTRAINT "AdvanceRecovery_advanceId_fkey" FOREIGN KEY ("advanceId") REFERENCES "EmployeeAdvance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

