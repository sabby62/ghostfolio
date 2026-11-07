import { CallerFacingError } from '@ghostfolio/api/errors/caller-facing.error';
import { AccountBalanceService } from '@ghostfolio/api/services/account-balance/account-balance.service';
import { AccountService } from '@ghostfolio/api/services/account/account.service';
import { DataProviderService } from '@ghostfolio/api/services/data-provider/data-provider.service';
import { ExchangeRateDataService } from '@ghostfolio/api/services/exchange-rate-data/exchange-rate-data.service';
import { ImportService } from '@ghostfolio/api/services/import/import.service';
import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';
import { UserService } from '@ghostfolio/api/services/user/user.service';

import { DataSource } from '@prisma/client';

import { SnapTradeClientService } from './snaptrade-client.service';
import { SnapTradeNotFoundError, SnapTradeService } from './snaptrade.service';

describe('SnapTradeService', () => {
  const userId = 'user-id';

  const connection = {
    createdAt: new Date(),
    id: 'connection-id',
    snapTradeUserId: null,
    updatedAt: new Date(),
    userId,
    userSecret: null
  };

  const snapTradeAccount = {
    accountId: 'account-id',
    accountUserId: userId,
    brokerageAuthorizationId: 'brokerage-authorization-id',
    connectionId: 'connection-id',
    createdAt: new Date(),
    currency: 'CAD',
    id: 'snaptrade-account-id',
    institutionName: 'Questrade',
    isSyncEnabled: true,
    lastSyncError: null,
    lastSyncedAt: null,
    name: 'TFSA',
    syncFromDate: new Date('2026-02-01T00:00:00.000Z'),
    updatedAt: new Date()
  };

  const xeqt = { currency: { code: 'CAD' }, symbol: 'XEQT.TO' };

  let accountBalanceService: AccountBalanceService;
  let accountService: AccountService;
  let importService: ImportService;
  let prismaService: PrismaService;
  let snapTradeClientService: SnapTradeClientService;
  let snapTradeService: SnapTradeService;

  beforeEach(() => {
    accountBalanceService = {
      createOrUpdateAccountBalance: jest.fn()
    } as unknown as AccountBalanceService;

    accountService = {
      account: jest
        .fn()
        .mockResolvedValue({ currency: 'CAD', id: 'account-id', userId }),
      createAccount: jest.fn().mockResolvedValue({ id: 'new-account-id' })
    } as unknown as AccountService;

    importService = {
      import: jest.fn().mockResolvedValue([])
    } as unknown as ImportService;

    prismaService = {
      order: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ date: new Date('2026-03-15T00:00:00.000Z') })
      },
      snapTradeAccount: {
        findFirst: jest.fn().mockResolvedValue(snapTradeAccount),
        findMany: jest.fn().mockResolvedValue([snapTradeAccount]),
        update: jest.fn().mockImplementation(({ data }) => {
          return { ...snapTradeAccount, ...data };
        })
      },
      snapTradeConnection: {
        create: jest.fn().mockResolvedValue(connection),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(connection)
      },
      snapTradeImportedActivity: {
        createMany: jest.fn(),
        findMany: jest.fn().mockResolvedValue([{ activityId: 'imported' }])
      }
    } as unknown as PrismaService;

    snapTradeClientService = {
      getActivities: jest.fn().mockResolvedValue([
        {
          amount: -3500,
          currency: { code: 'CAD' },
          fee: 0,
          id: 'buy',
          price: 35,
          symbol: xeqt,
          trade_date: '2026-03-02T00:00:00Z',
          type: 'BUY',
          units: 100
        },
        {
          amount: 42,
          currency: { code: 'CAD' },
          id: 'dividend',
          symbol: xeqt,
          trade_date: '2026-02-27T00:00:00Z',
          type: 'DIVIDEND'
        },
        {
          amount: 5000,
          currency: { code: 'CAD' },
          id: 'contribution',
          trade_date: '2026-02-26T00:00:00Z',
          type: 'CONTRIBUTION'
        },
        {
          amount: -1000,
          currency: { code: 'CAD' },
          id: 'before-sync-from-date',
          price: 10,
          symbol: xeqt,
          trade_date: '2026-01-15T00:00:00Z',
          type: 'BUY',
          units: 100
        },
        {
          amount: -350,
          currency: { code: 'CAD' },
          id: 'imported',
          price: 35,
          symbol: xeqt,
          trade_date: '2026-03-01T00:00:00Z',
          type: 'BUY',
          units: 10
        }
      ]),
      getBalances: jest.fn().mockResolvedValue([
        { cash: 100, currency: { code: 'CAD' } },
        { cash: 50, currency: { code: 'USD' } }
      ]),
      isEnabled: jest.fn().mockReturnValue(true),
      isPersonalMode: jest.fn().mockReturnValue(true)
    } as unknown as SnapTradeClientService;

    snapTradeService = new SnapTradeService(
      accountBalanceService,
      accountService,
      {
        getDataSourceForImport: jest.fn().mockReturnValue(DataSource.YAHOO)
      } as unknown as DataProviderService,
      {
        toCurrency: jest
          .fn()
          .mockImplementation((value: number, from: string, to: string) => {
            return from === to ? value : value * 1.4;
          })
      } as unknown as ExchangeRateDataService,
      importService,
      prismaService,
      snapTradeClientService,
      {
        user: jest.fn().mockResolvedValue({
          id: userId,
          settings: { settings: { baseCurrency: 'CAD' } }
        })
      } as unknown as UserService
    );
  });

  describe('syncAccounts', () => {
    it('imports the new activities, oldest first, and updates the cash balance', async () => {
      const [result] = await snapTradeService.syncAccounts({ userId });

      expect(snapTradeClientService.getActivities).toHaveBeenCalledWith({
        accountId: 'snaptrade-account-id',
        credentials: { userId: undefined, userSecret: undefined },
        startDate: snapTradeAccount.syncFromDate
      });

      const [{ activitiesDto }] = jest.mocked(importService.import).mock
        .calls[0];

      expect(
        activitiesDto.map(({ symbol, type }) => {
          return `${type} ${symbol}`;
        })
      ).toEqual(['DIVIDEND XEQT.TO', 'BUY XEQT.TO']);

      expect(
        prismaService.snapTradeImportedActivity.createMany
      ).toHaveBeenCalledWith({
        data: [
          {
            activityId: 'dividend',
            snapTradeAccountId: 'snaptrade-account-id'
          },
          { activityId: 'buy', snapTradeAccountId: 'snaptrade-account-id' }
        ],
        skipDuplicates: true
      });

      // 100 CAD + 50 USD at 1.4
      expect(
        accountBalanceService.createOrUpdateAccountBalance
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          accountId: 'account-id',
          balance: 170
        })
      );

      expect(result).toMatchObject({
        balance: 170,
        currency: 'CAD',
        failed: [],
        imported: 2,
        skipped: { 'Cash movement (covered by the cash balance)': 1 }
      });

      expect(prismaService.snapTradeAccount.update).toHaveBeenCalledWith({
        data: { lastSyncError: null, lastSyncedAt: expect.any(Date) },
        where: { id: 'snaptrade-account-id' }
      });
    });

    it('imports one by one after a failed batch and reports the failures', async () => {
      jest
        .mocked(importService.import)
        .mockRejectedValueOnce(new Error('batch failed'))
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce(new Error('Unknown symbol'));

      const [result] = await snapTradeService.syncAccounts({ userId });

      expect(importService.import).toHaveBeenCalledTimes(3);
      expect(result.imported).toBe(1);
      expect(result.failed).toEqual([
        { activityId: 'buy', message: 'XEQT.TO: Unknown symbol' }
      ]);
      expect(
        prismaService.snapTradeImportedActivity.createMany
      ).toHaveBeenCalledWith({
        data: [
          { activityId: 'dividend', snapTradeAccountId: 'snaptrade-account-id' }
        ],
        skipDuplicates: true
      });
      // The time of the last sync stays, hence the next sync retries the
      // failed activity
      expect(prismaService.snapTradeAccount.update).toHaveBeenCalledWith({
        data: { lastSyncError: '1 activity could not be imported' },
        where: { id: 'snaptrade-account-id' }
      });
    });

    it('fetches the activities from the last sync minus an overlap', async () => {
      jest.mocked(prismaService.snapTradeAccount.findMany).mockResolvedValue([
        {
          ...snapTradeAccount,
          lastSyncedAt: new Date('2026-06-30T00:00:00.000Z')
        }
      ]);

      await snapTradeService.syncAccounts({ userId });

      expect(snapTradeClientService.getActivities).toHaveBeenCalledWith(
        expect.objectContaining({
          startDate: new Date('2026-05-31T00:00:00.000Z')
        })
      );
    });

    it('stores the error of a failed sync', async () => {
      jest.mocked(snapTradeClientService.getActivities).mockRejectedValue({
        responseBody: { detail: 'Disabled' },
        status: 402
      });

      const [result] = await snapTradeService.syncAccounts({ userId });

      expect(result.error).toBe('SnapTrade answered with status 402: Disabled');
      expect(prismaService.snapTradeAccount.update).toHaveBeenCalledWith({
        data: { lastSyncError: 'SnapTrade answered with status 402: Disabled' },
        where: { id: 'snaptrade-account-id' }
      });
      expect(importService.import).not.toHaveBeenCalled();
    });

    it('refuses a user without connection', async () => {
      jest
        .mocked(prismaService.snapTradeConnection.findUnique)
        .mockResolvedValue(null);

      await expect(snapTradeService.syncAccounts({ userId })).rejects.toThrow(
        SnapTradeNotFoundError
      );
    });
  });

  describe('updateAccount', () => {
    it('imports only the activities after the latest activity of an existing account', async () => {
      await snapTradeService.updateAccount({
        userId,
        data: { accountId: 'account-id' },
        snapTradeAccountId: 'snaptrade-account-id'
      });

      expect(prismaService.snapTradeAccount.update).toHaveBeenCalledWith({
        data: {
          account: {
            connect: { id_userId: { userId, id: 'account-id' } }
          },
          isSyncEnabled: true,
          syncFromDate: new Date('2026-03-16T00:00:00.000Z')
        },
        where: { id: 'snaptrade-account-id' }
      });
    });

    it('imports the full history into a new account', async () => {
      await snapTradeService.updateAccount({
        userId,
        data: { createAccount: true },
        snapTradeAccountId: 'snaptrade-account-id'
      });

      expect(accountService.createAccount).toHaveBeenCalledWith({
        userId,
        data: {
          currency: 'CAD',
          name: 'Questrade TFSA',
          user: { connect: { id: userId } }
        }
      });

      expect(prismaService.snapTradeAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            account: {
              connect: { id_userId: { userId, id: 'new-account-id' } }
            },
            syncFromDate: null
          })
        })
      );
    });

    it('refuses an account of another user', async () => {
      jest.mocked(accountService.account).mockResolvedValue(null);

      await expect(
        snapTradeService.updateAccount({
          userId,
          data: { accountId: 'foreign-account-id' },
          snapTradeAccountId: 'snaptrade-account-id'
        })
      ).rejects.toThrow(CallerFacingError);

      expect(prismaService.snapTradeAccount.update).not.toHaveBeenCalled();
    });
  });

  describe('createConnectionLink', () => {
    it('refuses a second user with a personal API key', async () => {
      jest
        .mocked(prismaService.snapTradeConnection.findUnique)
        .mockResolvedValue(null);
      jest
        .mocked(prismaService.snapTradeConnection.findFirst)
        .mockResolvedValue({ ...connection, userId: 'other-user-id' });

      await expect(
        snapTradeService.createConnectionLink({ userId, data: {} })
      ).rejects.toThrow('connected to another user');

      expect(prismaService.snapTradeConnection.create).not.toHaveBeenCalled();
    });

    it('refuses the connection if SnapTrade is not configured', async () => {
      jest.mocked(snapTradeClientService.isEnabled).mockReturnValue(false);

      await expect(
        snapTradeService.createConnectionLink({ userId, data: {} })
      ).rejects.toThrow('SnapTrade is not configured');
    });
  });
});
