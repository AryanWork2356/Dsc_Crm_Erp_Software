-- A saved client rate is now the rate DSC quotes (profit already in it)
ALTER TABLE "ClientRate" ADD COLUMN "rate" DECIMAL(12,2) NOT NULL DEFAULT 0;
