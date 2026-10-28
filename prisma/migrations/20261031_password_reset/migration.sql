-- Passwords: people choose their own after the first sign-in, and can ask for a reset
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "passwordChangedAt" TIMESTAMP(3),
ADD COLUMN "resetRequestedAt" TIMESTAMP(3);
