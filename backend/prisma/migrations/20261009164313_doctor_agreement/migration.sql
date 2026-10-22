-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "lastAgreement" TEXT,
ADD COLUMN     "lastAgreementDate" DATE;

-- AlterTable
ALTER TABLE "visits" ADD COLUMN     "agreement" TEXT,
ADD COLUMN     "deviation" TEXT,
ADD COLUMN     "fact" TEXT;
