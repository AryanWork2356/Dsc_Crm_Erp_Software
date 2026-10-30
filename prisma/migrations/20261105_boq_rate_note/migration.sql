-- Where a rate filled from saved rates came from, when it was not an exact match (to be checked)
ALTER TABLE "BoqItem" ADD COLUMN "rateNote" TEXT;
