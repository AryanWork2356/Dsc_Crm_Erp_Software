-- CreateEnum
CREATE TYPE "RemarkStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateTable
CREATE TABLE "ProjectVendor" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "trade" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectVendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Remark" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT,
    "vendorId" TEXT,
    "trade" TEXT,
    "subject" TEXT NOT NULL,
    "status" "RemarkStatus" NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Remark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RemarkMessage" (
    "id" TEXT NOT NULL,
    "remarkId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RemarkMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectVendor_companyId_vendorId_idx" ON "ProjectVendor"("companyId", "vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectVendor_projectId_trade_key" ON "ProjectVendor"("projectId", "trade");

-- CreateIndex
CREATE INDEX "Remark_companyId_status_idx" ON "Remark"("companyId", "status");

-- CreateIndex
CREATE INDEX "Remark_companyId_createdById_idx" ON "Remark"("companyId", "createdById");

-- CreateIndex
CREATE INDEX "RemarkMessage_remarkId_createdAt_idx" ON "RemarkMessage"("remarkId", "createdAt");

-- AddForeignKey
ALTER TABLE "ProjectVendor" ADD CONSTRAINT "ProjectVendor_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectVendor" ADD CONSTRAINT "ProjectVendor_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Remark" ADD CONSTRAINT "Remark_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Remark" ADD CONSTRAINT "Remark_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemarkMessage" ADD CONSTRAINT "RemarkMessage_remarkId_fkey" FOREIGN KEY ("remarkId") REFERENCES "Remark"("id") ON DELETE CASCADE ON UPDATE CASCADE;

