-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('CASH', 'RRSP', 'TFSA');

-- AlterTable
ALTER TABLE "Account" ADD COLUMN "type" "AccountType" NOT NULL DEFAULT 'CASH';

-- AlterTable
ALTER TABLE "SnapTradeAccount" ADD COLUMN "rawType" TEXT;

-- CreateIndex
CREATE INDEX "Account_type_idx" ON "Account"("type");

-- Classify the existing accounts by their name or the name of the linked
-- SnapTrade account, all others remain non-registered cash accounts
UPDATE "Account" AS a
SET "type" = 'RRSP'
WHERE a."name" ~* '\m(RRSP|RSP)\M'
  OR EXISTS (
    SELECT 1 FROM "SnapTradeAccount" AS s
    WHERE s."accountId" = a."id"
      AND s."accountUserId" = a."userId"
      AND s."name" ~* '\m(RRSP|RSP)\M'
  );

UPDATE "Account" AS a
SET "type" = 'TFSA'
WHERE a."name" ~* '\mTFSA\M'
  OR EXISTS (
    SELECT 1 FROM "SnapTradeAccount" AS s
    WHERE s."accountId" = a."id"
      AND s."accountUserId" = a."userId"
      AND s."name" ~* '\mTFSA\M'
  );
