export type RebalancingMode = 'BUY_ONLY' | 'FULL';

export type RebalancingTradeAction = 'BUY' | 'SELL';

export interface RebalancingHoldingInput {
  currency?: string;
  dataSource: string;
  /** Cost of the holding in base currency */
  investmentInBaseCurrency?: number;
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
  /** Value minus cost in base currency */
  gainInBaseCurrency: number;
  /** Cost in base currency */
  investmentInBaseCurrency: number;
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

/**
 * Where the holdings come from: as reported by the brokerages (synced through
 * SnapTrade), as calculated by Ghostfolio from the activities or both
 */
export interface RebalancingHoldingsSource {
  /** The oldest time of the data of the brokerages */
  asOf: Date | null;
  /** The accounts of which the holdings are taken from the brokerage */
  brokerAccountIds: string[];
  source: 'BROKER' | 'GHOSTFOLIO' | 'MIXED';
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
