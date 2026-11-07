-- CreateTable
CREATE TABLE "SnapTradeAccount" (
    "accountId" TEXT,
    "accountUserId" TEXT,
    "connectionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currency" TEXT,
    "id" TEXT NOT NULL,
    "institutionName" TEXT,
    "isSyncEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncError" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "name" TEXT,
    "syncFromDate" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SnapTradeAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SnapTradeConnection" (
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "id" TEXT NOT NULL,
    "snapTradeUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "userSecret" TEXT,

    CONSTRAINT "SnapTradeConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SnapTradeImportedActivity" (
    "activityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapTradeAccountId" TEXT NOT NULL,

    CONSTRAINT "SnapTradeImportedActivity_pkey" PRIMARY KEY ("snapTradeAccountId","activityId")
);

-- CreateIndex
CREATE INDEX "SnapTradeAccount_accountId_accountUserId_idx" ON "SnapTradeAccount"("accountId", "accountUserId");

-- CreateIndex
CREATE INDEX "SnapTradeAccount_connectionId_idx" ON "SnapTradeAccount"("connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "SnapTradeConnection_userId_key" ON "SnapTradeConnection"("userId");

-- AddForeignKey
ALTER TABLE "SnapTradeAccount" ADD CONSTRAINT "SnapTradeAccount_accountId_accountUserId_fkey" FOREIGN KEY ("accountId", "accountUserId") REFERENCES "Account"("id", "userId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SnapTradeAccount" ADD CONSTRAINT "SnapTradeAccount_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "SnapTradeConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SnapTradeConnection" ADD CONSTRAINT "SnapTradeConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SnapTradeImportedActivity" ADD CONSTRAINT "SnapTradeImportedActivity_snapTradeAccountId_fkey" FOREIGN KEY ("snapTradeAccountId") REFERENCES "SnapTradeAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
