-- Sign-in: lock a login for 15 minutes after 5 wrong passwords in a row
ALTER TABLE "User" ADD COLUMN "failedLogins" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lockedUntil" TIMESTAMP(3);
