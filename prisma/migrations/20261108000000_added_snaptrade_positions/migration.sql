-- AlterTable
ALTER TABLE "SnapTradeAccount" ADD COLUMN     "cashBalances" JSONB,
ADD COLUMN     "positionsAsOf" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SnapTradePosition" (
    "averagePrice" DOUBLE PRECISION,
    "currency" TEXT NOT NULL,
    "dataSource" "DataSource" NOT NULL,
    "kind" TEXT,
    "name" TEXT,
    "price" DOUBLE PRECISION NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "snapTradeAccountId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,

    CONSTRAINT "SnapTradePosition_pkey" PRIMARY KEY ("snapTradeAccountId","dataSource","symbol")
);

-- AddForeignKey
ALTER TABLE "SnapTradePosition" ADD CONSTRAINT "SnapTradePosition_snapTradeAccountId_fkey" FOREIGN KEY ("snapTradeAccountId") REFERENCES "SnapTradeAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
