import {
  CreateSnapTradeConnectionLinkDto,
  UpdateSnapTradeAccountDto
} from '@ghostfolio/common/dtos';
import { Filter } from '@ghostfolio/common/interfaces';
import { translate } from '@ghostfolio/ui/i18n';
import { DataService } from '@ghostfolio/ui/services';

import { HttpClient } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { parseISO } from 'date-fns';
import { map } from 'rxjs';

import {
  SnapTradeAccount,
  SnapTradeAccountSyncResult,
  SnapTradeAlignment,
  SnapTradeAlignmentResult,
  SnapTradeHoldingsResponse,
  SnapTradeStatus
} from './snaptrade.interfaces';

@Service()
export class SnapTradeService {
  private readonly dataService = inject(DataService);
  private readonly http = inject(HttpClient);

  /**
   * Adds the activities which align the holdings of the linked account with
   * the positions of the brokerage
   */
  public align(snapTradeAccountId: string) {
    return this.http.post<SnapTradeAlignmentResult>(
      `/api/v1/snaptrade/accounts/${snapTradeAccountId}/align`,
      {}
    );
  }

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

  /**
   * Fetches the holdings as reported by the brokerages on the last sync
   */
  /**
   * Previews the activities which align the holdings of the linked account
   * with the positions of the brokerage
   */
  public fetchAlignment(snapTradeAccountId: string) {
    return this.http.get<SnapTradeAlignment>(
      `/api/v1/snaptrade/accounts/${snapTradeAccountId}/alignment`
    );
  }

  public fetchHoldings({ filters }: { filters?: Filter[] } = {}) {
    // The brokerage holdings can be filtered by account and asset class only
    const params = this.dataService.buildFiltersAsQueryParams({
      filters: filters?.filter(({ type }) => {
        return type === 'ACCOUNT' || type === 'ASSET_CLASS';
      })
    });

    return this.http
      .get<{
        asOf: string | null;
        holdings: SnapTradeHoldingsResponse['holdings'];
      }>('/api/v1/snaptrade/holdings', { params })
      .pipe(
        map(({ asOf, holdings }): SnapTradeHoldingsResponse => {
          for (const holding of holdings) {
            holding.assetProfile.assetClassLabel = translate(
              holding.assetProfile.assetClass
            );
            holding.assetProfile.assetSubClassLabel = translate(
              holding.assetProfile.assetSubClass
            );
          }

          return { holdings, asOf: asOf ? parseISO(asOf) : null };
        })
      );
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
