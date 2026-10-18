-- CreateEnum
CREATE TYPE "ClosureStatus" AS ENUM ('OPEN', 'SUBMITTED', 'CLOSED');

-- CreateTable
CREATE TABLE "ProjectClosure" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" "ClosureStatus" NOT NULL DEFAULT 'OPEN',
    "lessonsLearned" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "submittedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectClosure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectClosureItem" (
    "id" TEXT NOT NULL,
    "closureId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "docRequired" BOOLEAN NOT NULL DEFAULT true,
    "auto" BOOLEAN NOT NULL DEFAULT false,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "doneAt" TIMESTAMP(3),
    "doneById" TEXT,
    "note" TEXT,
    "docId" TEXT,

    CONSTRAINT "ProjectClosureItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectClosure_projectId_key" ON "ProjectClosure"("projectId");

-- CreateIndex
CREATE INDEX "ProjectClosure_companyId_status_idx" ON "ProjectClosure"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectClosureItem_closureId_key_key" ON "ProjectClosureItem"("closureId", "key");

-- AddForeignKey
ALTER TABLE "ProjectClosure" ADD CONSTRAINT "ProjectClosure_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectClosureItem" ADD CONSTRAINT "ProjectClosureItem_closureId_fkey" FOREIGN KEY ("closureId") REFERENCES "ProjectClosure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

