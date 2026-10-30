-- Site attendance kept with the morning update and evening report
CREATE TABLE "SiteLabour" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "work" TEXT,
    "taskId" TEXT,
    "inTime" TEXT,
    "outTime" TEXT,
    "markedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SiteLabour_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SiteLabour_projectId_date_name_key" ON "SiteLabour"("projectId", "date", "name");
CREATE INDEX "SiteLabour_companyId_date_idx" ON "SiteLabour"("companyId", "date");
