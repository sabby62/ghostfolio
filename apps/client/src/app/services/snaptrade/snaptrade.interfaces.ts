import { PortfolioPosition } from '@ghostfolio/common/interfaces';

export interface SnapTradeAccount {
  accountId: string | null;
  brokerageAuthorizationId: string | null;
  currency: string | null;
  id: string;
  institutionName: string | null;
  isAutoAlignEnabled: boolean;
  isConnectionDisabled: boolean;
  isSyncEnabled: boolean;
  lastSyncError: string | null;
  lastSyncedAt: string | null;
  name: string | null;
  positionsAsOf: string | null;
  syncFromDate: string | null;
}

export interface SnapTradeHoldingsResponse {
  /** The oldest time of the data of the brokerages, null without data */
  asOf: Date | null;
  holdings: PortfolioPosition[];
}

export interface SnapTradeStatus {
  accounts: SnapTradeAccount[];
  isConnected: boolean;
  isEnabled: boolean;
  mode: 'commercial' | 'personal';
}

export interface SnapTradeAlignmentCorrection {
  activities: { quantity: number; type: 'BUY' | 'SELL'; unitPrice: number }[];
  after: { averagePrice: number | null; quantity: number };
  before: { averagePrice: number | null; quantity: number };
  currency: string;
  dataSource: string;
  name: string | null;
  symbol: string;
}

export interface SnapTradeAlignment {
  accountId: string;
  asOf: string;
  corrections: SnapTradeAlignmentCorrection[];
  date: string;
  snapTradeAccountId: string;
}

export interface SnapTradeAlignmentResult {
  activities: number;
  aligned: number;
  failed: { message: string; symbol: string }[];
}

export interface SnapTradeAccountSyncResult {
  accountId: string;
  alignment?: SnapTradeAlignmentResult;
  alignmentError?: string;
  balance?: number;
  currency?: string;
  error?: string;
  failed: { activityId: string; message: string }[];
  imported: number;
  name: string | null;
  positions?: number;
  positionsError?: string;
  skipped: Record<string, number>;
  snapTradeAccountId: string;
}
