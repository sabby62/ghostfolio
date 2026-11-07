-- CreateTable
CREATE TABLE "RebalancingGroup" (
    "accountIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "driftThresholdInPercentage" DOUBLE PRECISION NOT NULL DEFAULT 0.05,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "RebalancingGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RebalancingTarget" (
    "dataSource" "DataSource" NOT NULL,
    "groupId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "targetInPercentage" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "RebalancingTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RebalancingGroup_userId_idx" ON "RebalancingGroup"("userId");

-- CreateIndex
CREATE INDEX "RebalancingTarget_groupId_idx" ON "RebalancingTarget"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "RebalancingTarget_groupId_dataSource_symbol_key" ON "RebalancingTarget"("groupId", "dataSource", "symbol");

-- AddForeignKey
ALTER TABLE "RebalancingGroup" ADD CONSTRAINT "RebalancingGroup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RebalancingTarget" ADD CONSTRAINT "RebalancingTarget_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "RebalancingGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
