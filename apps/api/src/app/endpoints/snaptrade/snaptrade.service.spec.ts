import { CallerFacingError } from '@ghostfolio/api/errors/caller-facing.error';
import { AccountBalanceService } from '@ghostfolio/api/services/account-balance/account-balance.service';
import { AccountService } from '@ghostfolio/api/services/account/account.service';
import { DataProviderService } from '@ghostfolio/api/services/data-provider/data-provider.service';
import { ExchangeRateDataService } from '@ghostfolio/api/services/exchange-rate-data/exchange-rate-data.service';
import { ImportService } from '@ghostfolio/api/services/import/import.service';
import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';
import { UserService } from '@ghostfolio/api/services/user/user.service';

import { DataSource } from '@prisma/client';

import { SnapTradeAlignmentService } from './snaptrade-alignment.service';
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
    cashBalances: null,
    connectionId: 'connection-id',
    createdAt: new Date(),
    currency: 'CAD',
    id: 'snaptrade-account-id',
    institutionName: 'Questrade',
    institutionUrl: null,
    isAutoAlignEnabled: false,
    isSyncEnabled: true,
    lastSyncError: null,
    lastSyncedAt: null,
    name: 'TFSA',
    positionsAsOf: null,
    rawType: 'TFSA',
    syncFromDate: new Date('2026-02-01T00:00:00.000Z'),
    updatedAt: new Date()
  };

  const xeqt = { currency: { code: 'CAD' }, symbol: 'XEQT.TO' };

  let accountBalanceService: AccountBalanceService;
  let accountService: AccountService;
  let importService: ImportService;
  let prismaService: PrismaService;
  let snapTradeAlignmentService: SnapTradeAlignmentService;
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
      $transaction: jest.fn().mockResolvedValue([]),
      account: {
        findUnique: jest.fn().mockResolvedValue({ platformId: null }),
        update: jest.fn()
      },
      platform: {
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: 'platform-id' })
      },
      order: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ date: new Date('2026-03-15T00:00:00.000Z') })
      },
      snapTradeAccount: {
        findFirst: jest.fn().mockResolvedValue(snapTradeAccount),
        findMany: jest.fn().mockResolvedValue([snapTradeAccount]),
        findUnique: jest.fn().mockResolvedValue(snapTradeAccount),
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
      },
      snapTradePosition: {
        createMany: jest.fn(),
        deleteMany: jest.fn()
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
      getPositions: jest.fn().mockResolvedValue({
        asOf: new Date('2026-11-08T00:22:44Z'),
        positions: [
          {
            cost_basis: '40',
            currency: 'CAD',
            instrument: { kind: 'etf', raw_symbol: 'XEQT', symbol: 'XEQT.TO' },
            price: '44',
            units: '10'
          },
          {
            cost_basis: '46',
            currency: 'CAD',
            instrument: { kind: 'etf', raw_symbol: 'XEQT', symbol: 'XEQT.TO' },
            price: '44',
            units: '30'
          },
          {
            currency: 'USD',
            instrument: { kind: 'option', symbol: 'NVDA 261218C00200000' },
            price: '1.5',
            units: '1'
          }
        ]
      }),
      isEnabled: jest.fn().mockReturnValue(true),
      isPersonalMode: jest.fn().mockReturnValue(true)
    } as unknown as SnapTradeClientService;

    snapTradeAlignmentService = {
      align: jest
        .fn()
        .mockResolvedValue({ activities: 2, aligned: 1, failed: [] })
    } as unknown as SnapTradeAlignmentService;

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
      snapTradeAlignmentService,
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

    it('stores the cash balances and the positions as reported by the brokerage', async () => {
      const [result] = await snapTradeService.syncAccounts({ userId });

      expect(prismaService.snapTradeAccount.update).toHaveBeenCalledWith({
        data: {
          cashBalances: [
            { amount: 100, currency: 'CAD' },
            { amount: 50, currency: 'USD' }
          ]
        },
        where: { id: 'snaptrade-account-id' }
      });

      expect(prismaService.snapTradePosition.deleteMany).toHaveBeenCalledWith({
        where: { snapTradeAccountId: 'snaptrade-account-id' }
      });

      // The two lots of XEQT.TO in one position, without the option
      expect(prismaService.snapTradePosition.createMany).toHaveBeenCalledWith({
        data: [
          {
            averagePrice: 44.5,
            currency: 'CAD',
            dataSource: DataSource.YAHOO,
            kind: 'etf',
            name: null,
            price: 44,
            quantity: 40,
            snapTradeAccountId: 'snaptrade-account-id',
            symbol: 'XEQT.TO'
          }
        ]
      });

      expect(prismaService.snapTradeAccount.update).toHaveBeenCalledWith({
        data: { positionsAsOf: new Date('2026-11-08T00:22:44Z') },
        where: { id: 'snaptrade-account-id' }
      });
      expect(prismaService.$transaction).toHaveBeenCalled();
      expect(result.positions).toBe(1);
    });

    it('sets the brokerage as the platform of the account', async () => {
      await snapTradeService.syncAccounts({ userId });

      expect(prismaService.platform.upsert).toHaveBeenCalledWith({
        create: { name: 'Questrade', url: 'https://www.questrade.com' },
        update: {},
        where: { url: 'https://www.questrade.com' }
      });
      expect(prismaService.account.update).toHaveBeenCalledWith({
        data: { platform: { connect: { id: 'platform-id' } } },
        where: { id_userId: { userId, id: 'account-id' } }
      });
    });

    it('keeps the platform of an account', async () => {
      jest
        .mocked(prismaService.account.findUnique)
        .mockResolvedValue({ platformId: 'other-platform-id' } as never);

      await snapTradeService.syncAccounts({ userId });

      expect(prismaService.platform.upsert).not.toHaveBeenCalled();
      expect(prismaService.account.update).not.toHaveBeenCalled();
    });

    it('aligns the holdings after the sync if enabled', async () => {
      jest
        .mocked(prismaService.snapTradeAccount.findMany)
        .mockResolvedValue([{ ...snapTradeAccount, isAutoAlignEnabled: true }]);

      const [result] = await snapTradeService.syncAccounts({ userId });

      expect(snapTradeAlignmentService.align).toHaveBeenCalledTimes(1);
      expect(result.alignment).toEqual({
        activities: 2,
        aligned: 1,
        failed: []
      });
    });

    it('does not align the holdings if an activity failed', async () => {
      jest
        .mocked(prismaService.snapTradeAccount.findMany)
        .mockResolvedValue([{ ...snapTradeAccount, isAutoAlignEnabled: true }]);
      jest
        .mocked(importService.import)
        .mockRejectedValueOnce(new Error('batch failed'))
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce(new Error('Unknown symbol'));

      const [result] = await snapTradeService.syncAccounts({ userId });

      expect(result.failed).toHaveLength(1);
      expect(result.alignmentError).toContain('Not aligned');
      expect(snapTradeAlignmentService.align).not.toHaveBeenCalled();
    });

    it('does not align the holdings if not enabled', async () => {
      await snapTradeService.syncAccounts({ userId });

      expect(snapTradeAlignmentService.align).not.toHaveBeenCalled();
    });

    it('keeps the activities if the positions cannot be fetched', async () => {
      jest.mocked(snapTradeClientService.getPositions).mockRejectedValue({
        responseBody: { detail: 'Unavailable' },
        status: 503
      });

      const [result] = await snapTradeService.syncAccounts({ userId });

      expect(result.imported).toBe(2);
      expect(result.error).toBeUndefined();
      expect(result.positionsError).toBe(
        'SnapTrade answered with status 503: Unavailable'
      );
      expect(prismaService.snapTradePosition.createMany).not.toHaveBeenCalled();
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
          isAutoAlignEnabled: false,
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
          type: 'TFSA',
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
