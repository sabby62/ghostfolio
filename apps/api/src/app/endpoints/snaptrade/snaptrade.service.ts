import { CallerFacingError } from '@ghostfolio/api/errors/caller-facing.error';
import { AccountBalanceService } from '@ghostfolio/api/services/account-balance/account-balance.service';
import { AccountService } from '@ghostfolio/api/services/account/account.service';
import { DataProviderService } from '@ghostfolio/api/services/data-provider/data-provider.service';
import { ExchangeRateDataService } from '@ghostfolio/api/services/exchange-rate-data/exchange-rate-data.service';
import { ImportService } from '@ghostfolio/api/services/import/import.service';
import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';
import { UserService } from '@ghostfolio/api/services/user/user.service';
import { DEFAULT_CURRENCY } from '@ghostfolio/common/config';
import {
  CreateOrderDto,
  CreateSnapTradeConnectionLinkDto,
  UpdateSnapTradeAccountDto
} from '@ghostfolio/common/dtos';
import { UserWithSettings } from '@ghostfolio/common/types';

import { Injectable, Logger } from '@nestjs/common';
import { SnapTradeAccount, SnapTradeConnection } from '@prisma/client';
import { addDays, format, subDays } from 'date-fns';
import { randomUUID } from 'node:crypto';

import {
  SnapTradeActivity,
  mapSnapTradeActivity
} from './snaptrade-activity.mapper';
import {
  SnapTradeClientService,
  SnapTradeUserCredentials
} from './snaptrade-client.service';

export interface SnapTradeAccountResponse {
  accountId: string | null;
  currency: string | null;
  id: string;
  institutionName: string | null;
  isConnectionDisabled: boolean;
  isSyncEnabled: boolean;
  lastSyncError: string | null;
  lastSyncedAt: Date | null;
  name: string | null;
  syncFromDate: Date | null;
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

export class SnapTradeNotFoundError extends CallerFacingError {
  public constructor(message: string) {
    super(message);

    this.name = 'SnapTradeNotFoundError';
  }
}

// Brokerages post some activities late, hence the activities of these days
// before the last sync are fetched again (the imported ones are skipped)
const RESYNC_OVERLAP_IN_DAYS = 30;

@Injectable()
export class SnapTradeService {
  private readonly logger = new Logger(SnapTradeService.name);

  public constructor(
    private readonly accountBalanceService: AccountBalanceService,
    private readonly accountService: AccountService,
    private readonly dataProviderService: DataProviderService,
    private readonly exchangeRateDataService: ExchangeRateDataService,
    private readonly importService: ImportService,
    private readonly prismaService: PrismaService,
    private readonly snapTradeClientService: SnapTradeClientService,
    private readonly userService: UserService
  ) {}

  public async createConnectionLink({
    data,
    userId
  }: {
    data: CreateSnapTradeConnectionLinkDto;
    userId: string;
  }) {
    this.assertEnabled();

    const connection = await this.getOrCreateConnection({ userId });

    try {
      const redirectURI =
        await this.snapTradeClientService.getConnectionPortalUrl({
          broker: data.broker,
          credentials: this.getCredentials(connection),
          reconnect: data.reconnect
        });

      return { redirectURI };
    } catch (error) {
      throw this.toCallerFacingError(error);
    }
  }

  public async deleteConnection({ userId }: { userId: string }) {
    const connection = await this.getConnection({ userId });

    if (!connection) {
      throw new SnapTradeNotFoundError('No SnapTrade connection found');
    }

    if (this.snapTradeClientService.isEnabled()) {
      try {
        await this.snapTradeClientService.deleteUser(
          this.getCredentials(connection)
        );
      } catch (error) {
        this.logger.warn(
          `Could not delete the SnapTrade user: ${(error as Error).message}`
        );
      }
    }

    await this.prismaService.snapTradeConnection.delete({
      where: { id: connection.id }
    });
  }

  public async getAccounts({
    userId
  }: {
    userId: string;
  }): Promise<SnapTradeAccountResponse[]> {
    this.assertEnabled();

    const connection = await this.getConnection({ userId });

    if (!connection) {
      return [];
    }

    const credentials = this.getCredentials(connection);

    let brokerageAccounts: Awaited<
      ReturnType<SnapTradeClientService['listAccounts']>
    >;
    let disabledConnectionIds = new Set<string>();

    try {
      brokerageAccounts =
        await this.snapTradeClientService.listAccounts(credentials);

      const connections =
        await this.snapTradeClientService.listConnections(credentials);

      disabledConnectionIds = new Set(
        connections
          .filter(({ disabled }) => {
            return disabled;
          })
          .map(({ id }) => {
            return id;
          })
      );
    } catch (error) {
      throw this.toCallerFacingError(error);
    }

    const accounts: SnapTradeAccountResponse[] = [];

    for (const brokerageAccount of brokerageAccounts) {
      const existing = await this.prismaService.snapTradeAccount.findUnique({
        where: { id: brokerageAccount.id }
      });

      if (existing && existing.connectionId !== connection.id) {
        // The account belongs to the connection of another user
        continue;
      }

      const data = {
        currency: brokerageAccount.balance?.total?.currency ?? null,
        institutionName: brokerageAccount.institution_name ?? null,
        name: brokerageAccount.name ?? null
      };

      const snapTradeAccount = await this.prismaService.snapTradeAccount.upsert(
        {
          create: {
            ...data,
            connection: { connect: { id: connection.id } },
            id: brokerageAccount.id
          },
          update: data,
          where: { id: brokerageAccount.id }
        }
      );

      accounts.push(
        this.toAccountResponse({
          snapTradeAccount,
          isConnectionDisabled: disabledConnectionIds.has(
            brokerageAccount.brokerage_authorization
          )
        })
      );
    }

    return accounts;
  }

  public async getStatus({ userId }: { userId: string }) {
    const connection = this.snapTradeClientService.isEnabled()
      ? await this.getConnection({ userId })
      : null;

    const accounts = connection
      ? await this.prismaService.snapTradeAccount.findMany({
          orderBy: [{ institutionName: 'asc' }, { name: 'asc' }],
          where: { connectionId: connection.id }
        })
      : [];

    return {
      accounts: accounts.map((snapTradeAccount) => {
        return this.toAccountResponse({
          snapTradeAccount,
          isConnectionDisabled: false
        });
      }),
      isConnected: Boolean(connection),
      isEnabled: this.snapTradeClientService.isEnabled(),
      mode: this.snapTradeClientService.isPersonalMode()
        ? 'personal'
        : 'commercial'
    };
  }

  public async syncAccounts({
    snapTradeAccountIds,
    userId
  }: {
    snapTradeAccountIds?: string[];
    userId: string;
  }): Promise<SnapTradeAccountSyncResult[]> {
    this.assertEnabled();

    const connection = await this.getConnection({ userId });

    if (!connection) {
      throw new SnapTradeNotFoundError('No SnapTrade connection found');
    }

    const snapTradeAccounts =
      await this.prismaService.snapTradeAccount.findMany({
        orderBy: [{ institutionName: 'asc' }, { name: 'asc' }],
        where: {
          accountId: { not: null },
          connectionId: connection.id,
          ...(snapTradeAccountIds?.length
            ? { id: { in: snapTradeAccountIds } }
            : { isSyncEnabled: true })
        }
      });

    const user = await this.userService.user({ id: userId });
    const results: SnapTradeAccountSyncResult[] = [];

    for (const snapTradeAccount of snapTradeAccounts) {
      results.push(
        await this.syncAccount({
          snapTradeAccount,
          user,
          credentials: this.getCredentials(connection)
        })
      );
    }

    return results;
  }

  /**
   * Syncs the linked accounts of all users, which the scheduler calls
   */
  public async syncAllUsers() {
    if (!this.snapTradeClientService.isEnabled()) {
      return;
    }

    const connections = await this.prismaService.snapTradeConnection.findMany({
      select: { userId: true }
    });

    for (const { userId } of connections) {
      try {
        const results = await this.syncAccounts({ userId });

        const imported = results.reduce((sum, result) => {
          return sum + result.imported;
        }, 0);

        this.logger.log(
          `Synced ${results.length} SnapTrade account(s), imported ${imported} activities`
        );
      } catch (error) {
        this.logger.error(
          `Could not sync the SnapTrade accounts: ${(error as Error).message}`
        );
      }
    }
  }

  public async updateAccount({
    data,
    snapTradeAccountId,
    userId
  }: {
    data: UpdateSnapTradeAccountDto;
    snapTradeAccountId: string;
    userId: string;
  }): Promise<SnapTradeAccountResponse> {
    const connection = await this.getConnection({ userId });

    const snapTradeAccount = connection
      ? await this.prismaService.snapTradeAccount.findFirst({
          where: { connectionId: connection.id, id: snapTradeAccountId }
        })
      : null;

    if (!snapTradeAccount) {
      throw new SnapTradeNotFoundError('The SnapTrade account was not found');
    }

    if (data.createAccount && data.accountId) {
      throw new CallerFacingError(
        'Either link an existing account or create a new account'
      );
    }

    let accountId = snapTradeAccount.accountId;
    let syncFromDate = snapTradeAccount.syncFromDate;

    if (data.createAccount) {
      const account = await this.accountService.createAccount({
        userId,
        data: {
          currency: snapTradeAccount.currency ?? DEFAULT_CURRENCY,
          name: [snapTradeAccount.institutionName, snapTradeAccount.name]
            .filter(Boolean)
            .join(' '),
          user: { connect: { id: userId } }
        }
      });

      accountId = account.id;
      // A new account is empty, hence the full history is imported
      syncFromDate = null;
    } else if (data.accountId !== undefined) {
      if (data.accountId) {
        const account = await this.accountService.account({
          id_userId: { userId, id: data.accountId }
        });

        if (!account) {
          throw new CallerFacingError('The account was not found');
        }

        if (data.syncFromDate === undefined) {
          // The activities of an existing account are not imported twice
          syncFromDate = await this.getDayAfterLatestActivity({
            userId,
            accountId: data.accountId
          });
        }
      }

      accountId = data.accountId;
    }

    if (data.syncFromDate !== undefined) {
      syncFromDate = data.syncFromDate ? new Date(data.syncFromDate) : null;
    }

    const updatedSnapTradeAccount =
      await this.prismaService.snapTradeAccount.update({
        data: {
          syncFromDate,
          account: accountId
            ? { connect: { id_userId: { userId, id: accountId } } }
            : { disconnect: true },
          isSyncEnabled: data.isSyncEnabled ?? snapTradeAccount.isSyncEnabled
        },
        where: { id: snapTradeAccount.id }
      });

    return this.toAccountResponse({
      isConnectionDisabled: false,
      snapTradeAccount: updatedSnapTradeAccount
    });
  }

  private assertEnabled() {
    if (!this.snapTradeClientService.isEnabled()) {
      throw new CallerFacingError(
        'SnapTrade is not configured: set SNAPTRADE_CLIENT_ID and SNAPTRADE_CONSUMER_KEY'
      );
    }
  }

  private async getBalanceInCurrency({
    credentials,
    currency,
    snapTradeAccountId
  }: {
    credentials: SnapTradeUserCredentials;
    currency: string;
    snapTradeAccountId: string;
  }) {
    const balances = await this.snapTradeClientService.getBalances({
      credentials,
      accountId: snapTradeAccountId
    });

    let balance = 0;

    for (const { cash, currency: balanceCurrency } of balances) {
      if (!cash) {
        continue;
      }

      balance += this.exchangeRateDataService.toCurrency(
        cash,
        balanceCurrency?.code ?? currency,
        currency
      );
    }

    return balance;
  }

  private getConnection({ userId }: { userId: string }) {
    return this.prismaService.snapTradeConnection.findUnique({
      where: { userId }
    });
  }

  private getCredentials(
    connection: SnapTradeConnection
  ): SnapTradeUserCredentials {
    return {
      userId: connection.snapTradeUserId ?? undefined,
      userSecret: connection.userSecret ?? undefined
    };
  }

  private async getDayAfterLatestActivity({
    accountId,
    userId
  }: {
    accountId: string;
    userId: string;
  }) {
    const latestActivity = await this.prismaService.order.findFirst({
      orderBy: { date: 'desc' },
      select: { date: true },
      where: { accountId, userId }
    });

    return latestActivity ? addDays(latestActivity.date, 1) : null;
  }

  private async getOrCreateConnection({ userId }: { userId: string }) {
    const connection = await this.getConnection({ userId });

    if (connection) {
      return connection;
    }

    if (this.snapTradeClientService.isPersonalMode()) {
      // A personal API key belongs to a single SnapTrade user
      const connectionOfOtherUser =
        await this.prismaService.snapTradeConnection.findFirst({
          where: { userId: { not: userId } }
        });

      if (connectionOfOtherUser) {
        throw new CallerFacingError(
          'The personal SnapTrade API key is connected to another user'
        );
      }

      return this.prismaService.snapTradeConnection.create({
        data: { user: { connect: { id: userId } } }
      });
    }

    try {
      // A random identifier, hence no data of the user is sent to SnapTrade
      const { userId: snapTradeUserId, userSecret } =
        await this.snapTradeClientService.registerUser(randomUUID());

      return this.prismaService.snapTradeConnection.create({
        data: {
          snapTradeUserId,
          userSecret,
          user: { connect: { id: userId } }
        }
      });
    } catch (error) {
      throw this.toCallerFacingError(error);
    }
  }

  private async importActivities({
    activities,
    user
  }: {
    activities: { activity: CreateOrderDto; activityId: string }[];
    user: UserWithSettings;
  }) {
    const importedActivityIds: string[] = [];
    const failed: { activityId: string; message: string }[] = [];

    const importBatch = async (
      batch: { activity: CreateOrderDto; activityId: string }[]
    ) => {
      await this.importService.import({
        user,
        accountsWithBalancesDto: [],
        activitiesDto: batch.map(({ activity }) => {
          return { ...activity };
        }),
        assetProfilesWithMarketDataDto: [],
        platformsDto: [],
        tagsDto: []
      });

      importedActivityIds.push(
        ...batch.map(({ activityId }) => {
          return activityId;
        })
      );
    };

    try {
      await importBatch(activities);
    } catch {
      // The import validates all activities before it persists one, hence
      // the activities are imported one by one to skip only the invalid ones
      for (const activity of activities) {
        try {
          await importBatch([activity]);
        } catch (error) {
          failed.push({
            activityId: activity.activityId,
            message: `${activity.activity.symbol}: ${(error as Error).message}`
          });
        }
      }
    }

    return { failed, importedActivityIds };
  }

  private async syncAccount({
    credentials,
    snapTradeAccount,
    user
  }: {
    credentials: SnapTradeUserCredentials;
    snapTradeAccount: SnapTradeAccount;
    user: UserWithSettings;
  }): Promise<SnapTradeAccountSyncResult> {
    const result: SnapTradeAccountSyncResult = {
      accountId: snapTradeAccount.accountId,
      failed: [],
      imported: 0,
      name: snapTradeAccount.name,
      skipped: {},
      snapTradeAccountId: snapTradeAccount.id
    };

    try {
      const account = await this.accountService.account({
        id_userId: { id: snapTradeAccount.accountId, userId: user.id }
      });

      if (!account) {
        throw new Error('The linked account was not found');
      }

      const startDate = this.getStartDate(snapTradeAccount);

      const activities = (await this.snapTradeClientService.getActivities({
        credentials,
        startDate,
        accountId: snapTradeAccount.id
      })) as SnapTradeActivity[];

      const importedActivityIds = new Set(
        (
          await this.prismaService.snapTradeImportedActivity.findMany({
            select: { activityId: true },
            where: { snapTradeAccountId: snapTradeAccount.id }
          })
        ).map(({ activityId }) => {
          return activityId;
        })
      );

      const dataSource = this.dataProviderService.getDataSourceForImport();
      const activitiesToImport: {
        activity: CreateOrderDto;
        activityId: string;
      }[] = [];

      for (const activity of activities) {
        if (activity.id && importedActivityIds.has(activity.id)) {
          continue;
        }

        const mapped = mapSnapTradeActivity({
          activity,
          dataSource,
          accountId: account.id
        });

        if ('reason' in mapped) {
          result.skipped[mapped.reason] =
            (result.skipped[mapped.reason] ?? 0) + 1;

          continue;
        }

        if (
          snapTradeAccount.syncFromDate &&
          new Date(mapped.activity.date) < snapTradeAccount.syncFromDate
        ) {
          continue;
        }

        activitiesToImport.push(mapped);
      }

      // The oldest activity first
      activitiesToImport.sort((a, b) => {
        return a.activity.date.localeCompare(b.activity.date);
      });

      if (activitiesToImport.length > 0) {
        const { failed, importedActivityIds: newActivityIds } =
          await this.importActivities({ user, activities: activitiesToImport });

        if (newActivityIds.length > 0) {
          await this.prismaService.snapTradeImportedActivity.createMany({
            data: newActivityIds.map((activityId) => {
              return { activityId, snapTradeAccountId: snapTradeAccount.id };
            }),
            skipDuplicates: true
          });
        }

        result.failed = failed;
        result.imported = newActivityIds.length;
      }

      result.currency = account.currency ?? DEFAULT_CURRENCY;
      result.balance = await this.getBalanceInCurrency({
        credentials,
        currency: result.currency,
        snapTradeAccountId: snapTradeAccount.id
      });

      await this.accountBalanceService.createOrUpdateAccountBalance({
        accountId: account.id,
        balance: result.balance,
        date: format(new Date(), 'yyyy-MM-dd'),
        userId: user.id
      });

      // The time of the last sync limits the activities of the next sync,
      // hence it only advances if every activity is imported. Otherwise, the
      // next sync fetches the same period again and retries the failed ones.
      await this.prismaService.snapTradeAccount.update({
        data:
          result.failed.length > 0
            ? {
                lastSyncError: `${result.failed.length} activities could not be imported`
              }
            : { lastSyncError: null, lastSyncedAt: new Date() },
        where: { id: snapTradeAccount.id }
      });
    } catch (error) {
      result.error = this.toCallerFacingError(error).message;

      await this.prismaService.snapTradeAccount.update({
        data: { lastSyncError: result.error },
        where: { id: snapTradeAccount.id }
      });
    }

    return result;
  }

  private getStartDate({ lastSyncedAt, syncFromDate }: SnapTradeAccount) {
    const overlapStart = lastSyncedAt
      ? subDays(lastSyncedAt, RESYNC_OVERLAP_IN_DAYS)
      : undefined;

    if (syncFromDate && overlapStart) {
      return syncFromDate > overlapStart ? syncFromDate : overlapStart;
    }

    return syncFromDate ?? overlapStart;
  }

  private toAccountResponse({
    isConnectionDisabled,
    snapTradeAccount
  }: {
    isConnectionDisabled: boolean;
    snapTradeAccount: SnapTradeAccount;
  }): SnapTradeAccountResponse {
    return {
      isConnectionDisabled,
      accountId: snapTradeAccount.accountId,
      currency: snapTradeAccount.currency,
      id: snapTradeAccount.id,
      institutionName: snapTradeAccount.institutionName,
      isSyncEnabled: snapTradeAccount.isSyncEnabled,
      lastSyncError: snapTradeAccount.lastSyncError,
      lastSyncedAt: snapTradeAccount.lastSyncedAt,
      name: snapTradeAccount.name,
      syncFromDate: snapTradeAccount.syncFromDate
    };
  }

  private toCallerFacingError(error: unknown) {
    if (error instanceof CallerFacingError) {
      return error;
    }

    const { responseBody, status } = (error ?? {}) as {
      responseBody?: { detail?: string; message?: string };
      status?: number;
    };

    const detail = responseBody?.detail ?? responseBody?.message;

    this.logger.warn(
      `SnapTrade request failed${status ? ` (${status})` : ''}: ${
        detail ?? (error as Error)?.message
      }`
    );

    return new CallerFacingError(
      status
        ? `SnapTrade answered with status ${status}${detail ? `: ${detail}` : ''}`
        : ((error as Error)?.message ?? 'SnapTrade request failed')
    );
  }
}
