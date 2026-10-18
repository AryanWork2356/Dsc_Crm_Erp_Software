-- AlterTable
ALTER TABLE "BoqItem" ADD COLUMN     "measurements" JSONB;

-- AlterTable
ALTER TABLE "CompanySettings" ADD COLUMN     "defaultPaymentTerms" TEXT NOT NULL DEFAULT '50% advance payment; 40% before project handover; 10% within 15 days of final bill. Final billing as per actual quantities.';

