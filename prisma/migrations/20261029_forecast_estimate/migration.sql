-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "estimateNote" TEXT,
ADD COLUMN     "estimateToComplete" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "estimateUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "estimateUpdatedById" TEXT;

