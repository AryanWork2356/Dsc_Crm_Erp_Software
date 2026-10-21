-- AlterTable
ALTER TABLE "BoqItem" ADD COLUMN     "package" TEXT,
ADD COLUMN     "ref" TEXT,
ADD COLUMN     "remarks" TEXT;

-- AlterTable
ALTER TABLE "Quotation" ADD COLUMN     "clientPoDate" TIMESTAMP(3),
ADD COLUMN     "clientPoNo" TEXT,
ADD COLUMN     "vendorCode" TEXT;

-- AlterTable
ALTER TABLE "QuotationItem" ADD COLUMN     "package" TEXT,
ADD COLUMN     "ref" TEXT,
ADD COLUMN     "remarks" TEXT,
ADD COLUMN     "section" TEXT,
ADD COLUMN     "specification" TEXT;

