import {
  CreateSnapTradeConnectionLinkDto,
  UpdateSnapTradeAccountDto
} from '@ghostfolio/common/dtos';

import { HttpClient } from '@angular/common/http';
import { inject, Service } from '@angular/core';

import {
  SnapTradeAccount,
  SnapTradeAccountSyncResult,
  SnapTradeStatus
} from './snaptrade.interfaces';

@Service()
export class SnapTradeService {
  private readonly http = inject(HttpClient);

  public createConnectionLink(data: CreateSnapTradeConnectionLinkDto = {}) {
    return this.http.post<{ redirectURI: string }>(
      '/api/v1/snaptrade/connection-link',
      data
    );
  }

  public deleteConnection() {
    return this.http.delete<void>('/api/v1/snaptrade/connection');
  }

  /**
   * Refreshes the brokerage accounts from SnapTrade
   */
  public fetchAccounts() {
    return this.http.get<SnapTradeAccount[]>('/api/v1/snaptrade/accounts');
  }

  public fetchStatus() {
    return this.http.get<SnapTradeStatus>('/api/v1/snaptrade/status');
  }

  public sync(snapTradeAccountIds?: string[]) {
    return this.http.post<SnapTradeAccountSyncResult[]>(
      '/api/v1/snaptrade/sync',
      { snapTradeAccountIds }
    );
  }

  public updateAccount({
    data,
    snapTradeAccountId
  }: {
    data: UpdateSnapTradeAccountDto;
    snapTradeAccountId: string;
  }) {
    return this.http.put<SnapTradeAccount>(
      `/api/v1/snaptrade/accounts/${snapTradeAccountId}`,
      data
    );
  }
}
