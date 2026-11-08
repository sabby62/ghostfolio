import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';

import { Injectable } from '@nestjs/common';
import {
  Account,
  AccountPosition,
  AccountUniversalActivity,
  Balance,
  BrokerageAuthorization,
  Snaptrade,
  SnaptradeAuth
} from 'snaptrade-typescript-sdk';

/**
 * The credentials of a SnapTrade user, which are only passed with a commercial
 * API key. A personal API key identifies the user itself.
 */
export interface SnapTradeUserCredentials {
  userId?: string;
  userSecret?: string;
}

const ACTIVITIES_PAGE_SIZE = 1000;
const MAX_ACTIVITIES_PAGES = 50;

/**
 * Thin wrapper of the SnapTrade SDK which hides the authentication mode
 */
@Injectable()
export class SnapTradeClientService {
  private client: Snaptrade<
    | ReturnType<(typeof SnaptradeAuth)['commercialApiKey']>
    | ReturnType<(typeof SnaptradeAuth)['personalApiKey']>
  >;

  public constructor(
    private readonly configurationService: ConfigurationService
  ) {}

  public async deleteUser(credentials: SnapTradeUserCredentials) {
    if (this.isPersonalMode()) {
      return;
    }

    await this.getApi().authentication.deleteSnapTradeUser({
      userId: credentials.userId
    } as never);
  }

  public async getActivities({
    accountId,
    credentials,
    startDate
  }: {
    accountId: string;
    credentials: SnapTradeUserCredentials;
    startDate?: Date;
  }): Promise<AccountUniversalActivity[]> {
    const activities: AccountUniversalActivity[] = [];

    for (let page = 0; page < MAX_ACTIVITIES_PAGES; page++) {
      const { data } =
        await this.getApi().accountInformation.getAccountActivities({
          ...this.getCredentialParameters(credentials),
          accountId,
          limit: ACTIVITIES_PAGE_SIZE,
          offset: activities.length,
          // SnapTrade accepts a date without time (YYYY-MM-DD) only
          startDate: startDate?.toISOString().slice(0, 10)
        } as never);

      const pageOfActivities = data?.data ?? [];
      activities.push(...pageOfActivities);

      const total = data?.pagination?.total ?? activities.length;

      if (pageOfActivities.length === 0 || activities.length >= total) {
        break;
      }
    }

    return activities;
  }

  public async getBalances({
    accountId,
    credentials
  }: {
    accountId: string;
    credentials: SnapTradeUserCredentials;
  }): Promise<Balance[]> {
    const { data } =
      await this.getApi().accountInformation.getUserAccountBalance({
        ...this.getCredentialParameters(credentials),
        accountId
      } as never);

    return data ?? [];
  }

  public async getConnectionPortalUrl({
    broker,
    credentials,
    reconnect
  }: {
    broker?: string;
    credentials: SnapTradeUserCredentials;
    reconnect?: string;
  }) {
    const { data } = await this.getApi().authentication.loginSnapTradeUser({
      ...this.getCredentialParameters(credentials),
      broker,
      connectionType: 'read',
      reconnect
    } as never);

    const redirectURI = (data as { redirectURI?: string })?.redirectURI;

    if (!redirectURI) {
      throw new Error('SnapTrade did not return a connection portal link');
    }

    return redirectURI;
  }

  public async getPositions({
    accountId,
    credentials
  }: {
    accountId: string;
    credentials: SnapTradeUserCredentials;
  }): Promise<{ asOf?: Date; positions: AccountPosition[] }> {
    const { data } =
      await this.getApi().accountInformation.getAllAccountPositions({
        ...this.getCredentialParameters(credentials),
        accountId
      } as never);

    const asOf = data?.data_freshness?.as_of
      ? new Date(data.data_freshness.as_of)
      : undefined;

    return {
      asOf: asOf && !isNaN(asOf.getTime()) ? asOf : undefined,
      // Some versions of the API name the list "positions"
      positions:
        data?.results ??
        ((data as Record<string, unknown>)?.positions as AccountPosition[]) ??
        []
    };
  }

  public isEnabled() {
    return Boolean(
      this.configurationService.get('SNAPTRADE_CLIENT_ID') &&
      this.configurationService.get('SNAPTRADE_CONSUMER_KEY')
    );
  }

  public isPersonalMode() {
    return this.configurationService.get('SNAPTRADE_AUTH_MODE') === 'personal';
  }

  public async listAccounts(
    credentials: SnapTradeUserCredentials
  ): Promise<Account[]> {
    const { data } = await this.getApi().accountInformation.listUserAccounts(
      this.getCredentialParameters(credentials) as never
    );

    return data ?? [];
  }

  public async listConnections(
    credentials: SnapTradeUserCredentials
  ): Promise<BrokerageAuthorization[]> {
    const { data } =
      await this.getApi().connections.listBrokerageAuthorizations(
        this.getCredentialParameters(credentials) as never
      );

    return data ?? [];
  }

  public async registerUser(snapTradeUserId: string) {
    const { data } = await this.getApi().authentication.registerSnapTradeUser({
      userId: snapTradeUserId
    } as never);

    if (!data?.userId || !data?.userSecret) {
      throw new Error('SnapTrade did not register the user');
    }

    return { userId: data.userId, userSecret: data.userSecret };
  }

  private getApi() {
    if (!this.isEnabled()) {
      throw new Error('SnapTrade is not configured');
    }

    if (!this.client) {
      const credentials = {
        clientId: this.configurationService.get('SNAPTRADE_CLIENT_ID'),
        consumerKey: this.configurationService.get('SNAPTRADE_CONSUMER_KEY')
      };

      this.client = new Snaptrade({
        auth: this.isPersonalMode()
          ? SnaptradeAuth.personalApiKey(credentials)
          : SnaptradeAuth.commercialApiKey(credentials)
      });
    }

    return this.client;
  }

  private getCredentialParameters({
    userId,
    userSecret
  }: SnapTradeUserCredentials) {
    return this.isPersonalMode() ? {} : { userId, userSecret };
  }
}
