export type RebalancingMode = 'BUY_ONLY' | 'FULL';

export type RebalancingTradeAction = 'BUY' | 'SELL';

export interface RebalancingHoldingInput {
  currency?: string;
  dataSource: string;
  name?: string;
  priceInBaseCurrency?: number;
  quantity: number;
  symbol: string;
  valueInBaseCurrency: number;
}

export interface RebalancingTargetInput {
  currency?: string;
  dataSource: string;
  name?: string;
  /** Only needed if the target is not held yet */
  priceInBaseCurrency?: number;
  symbol: string;
  /** Fraction, e.g. 0.25 for 25% */
  targetInPercentage: number;
}

export interface RebalancingDriftPosition {
  currency?: string;
  currentInPercentage: number;
  dataSource: string;
  /** Current minus target, e.g. 0.03 means 3 percentage points overweight */
  driftInPercentage: number;
  exceedsThreshold: boolean;
  /** False for a holding which has no target (its target is 0) */
  isTargeted: boolean;
  name?: string;
  quantity: number;
  symbol: string;
  targetInPercentage: number;
  valueInBaseCurrency: number;
}

export interface RebalancingDrift {
  cash: {
    currentInPercentage: number;
    driftInPercentage: number;
    targetInPercentage: number;
    valueInBaseCurrency: number;
  };
  driftThresholdInPercentage: number;
  maxAbsoluteDriftInPercentage: number;
  needsRebalancing: boolean;
  positions: RebalancingDriftPosition[];
  totalValueInBaseCurrency: number;
}

export interface RebalancingTrade {
  action: RebalancingTradeAction;
  currency?: string;
  dataSource: string;
  name?: string;
  priceInBaseCurrency: number;
  quantity: number;
  symbol: string;
  valueInBaseCurrency: number;
}

export interface RebalancingPlan {
  after: RebalancingDrift;
  allowFractionalShares: boolean;
  before: RebalancingDrift;
  cashAfterInBaseCurrency: number;
  mode: RebalancingMode;
  newCashInBaseCurrency: number;
  trades: RebalancingTrade[];
  warnings: string[];
}

export interface RebalancingGroupResponse {
  accountIds: string[];
  baseCurrency?: string;
  createdAt: Date;
  driftThresholdInPercentage: number;
  id: string;
  name: string;
  targets: {
    dataSource: string;
    symbol: string;
    targetInPercentage: number;
  }[];
  updatedAt: Date;
}
