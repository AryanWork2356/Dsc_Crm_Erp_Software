-- Crew needs made from schedule tasks; working late; phone alerts; app-made keys
ALTER TABLE "ResourceNeed" ADD COLUMN "taskId" TEXT;
CREATE INDEX "ResourceNeed_taskId_idx" ON "ResourceNeed"("taskId");

CREATE TABLE "LateWork" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "until" TEXT NOT NULL,
    "reason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LateWork_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LateWork_projectId_date_key" ON "LateWork"("projectId", "date");
CREATE INDEX "LateWork_companyId_date_idx" ON "LateWork"("companyId", "date");

CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

CREATE TABLE "AppSecret" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AppSecret_pkey" PRIMARY KEY ("key")
);
