-- CreateEnum
CREATE TYPE "DailyWorkStatus" AS ENUM ('PENDING', 'DONE');

-- CreateTable
CREATE TABLE "DailyWork" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "assignedToId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "details" TEXT,
    "dueAt" TIMESTAMP(3),
    "status" "DailyWorkStatus" NOT NULL DEFAULT 'PENDING',
    "doneAt" TIMESTAMP(3),
    "doneNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyWork_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyLog" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyWork_companyId_assignedToId_status_idx" ON "DailyWork"("companyId", "assignedToId", "status");

-- CreateIndex
CREATE INDEX "DailyWork_companyId_status_createdAt_idx" ON "DailyWork"("companyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "DailyLog_companyId_day_idx" ON "DailyLog"("companyId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "DailyLog_userId_day_key" ON "DailyLog"("userId", "day");

