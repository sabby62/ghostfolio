export interface SnapTradeAccount {
  accountId: string | null;
  brokerageAuthorizationId: string | null;
  currency: string | null;
  id: string;
  institutionName: string | null;
  isConnectionDisabled: boolean;
  isSyncEnabled: boolean;
  lastSyncError: string | null;
  lastSyncedAt: string | null;
  name: string | null;
  syncFromDate: string | null;
}

export interface SnapTradeStatus {
  accounts: SnapTradeAccount[];
  isConnected: boolean;
  isEnabled: boolean;
  mode: 'commercial' | 'personal';
}

export interface SnapTradeAccountSyncResult {
  accountId: string;
  balance?: number;
  currency?: string;
  error?: string;
  failed: { activityId: string; message: string }[];
  imported: number;
  name: string | null;
  skipped: Record<string, number>;
  snapTradeAccountId: string;
}
