export type RebalancingMode = 'BUY_ONLY' | 'FULL';

export interface RebalancingGroup {
  accountIds: string[];
  driftThresholdInPercentage: number;
  id: string;
  name: string;
  targets: {
    dataSource: string;
    symbol: string;
    targetInPercentage: number;
  }[];
}

export interface RebalancingDriftPosition {
  currency?: string;
  currentInPercentage: number;
  dataSource: string;
  driftInPercentage: number;
  exceedsThreshold: boolean;
  gainInBaseCurrency: number;
  investmentInBaseCurrency: number;
  isTargeted: boolean;
  name?: string;
  quantity: number;
  symbol: string;
  targetInPercentage: number;
  valueInBaseCurrency: number;
}

export interface RebalancingDrift {
  baseCurrency?: string;
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
  action: 'BUY' | 'SELL';
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
  baseCurrency: string;
  before: RebalancingDrift;
  cashAfterInBaseCurrency: number;
  mode: RebalancingMode;
  newCashInBaseCurrency: number;
  trades: RebalancingTrade[];
  warnings: string[];
}
