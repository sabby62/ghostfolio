import { ActivitiesService } from '@ghostfolio/api/services/activities/activities.service';
import { ExchangeRateDataService } from '@ghostfolio/api/services/exchange-rate-data/exchange-rate-data.service';
import { ImportService } from '@ghostfolio/api/services/import/import.service';
import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';
import { UserService } from '@ghostfolio/api/services/user/user.service';
import { UserWithSettings } from '@ghostfolio/common/types';

import { AssetSubClass, DataSource, SnapTradeAccount } from '@prisma/client';

import {
  SnapTradeAlignmentError,
  SnapTradeAlignmentService
} from './snaptrade-alignment.service';

describe('SnapTradeAlignmentService', () => {
  const positionsAsOf = new Date('2026-11-08T00:22:44.000Z');

  const snapTradeAccount = {
    positionsAsOf,
    accountId: 'account-id',
    id: 'snaptrade-account-id'
  } as SnapTradeAccount;

  const user = {
    id: 'user-id',
    settings: { settings: { baseCurrency: 'CAD' } }
  } as unknown as UserWithSettings;

  const activity = ({
    date,
    quantity,
    symbol,
    type,
    unitPrice
  }: {
    date: string;
    quantity: number;
    symbol: string;
    type: string;
    unitPrice: number;
  }) => {
    return {
      quantity,
      type,
      assetProfile: {
        assetSubClass: AssetSubClass.ETF,
        currency: symbol === 'NVDA' ? 'USD' : 'CAD',
        dataSource: DataSource.YAHOO,
        name: symbol,
        symbol
      },
      date: new Date(date),
      unitPriceInAssetProfileCurrency: unitPrice
    };
  };

  let importService: ImportService;
  let snapTradeAlignmentService: SnapTradeAlignmentService;

  beforeEach(() => {
    importService = {
      import: jest.fn().mockResolvedValue([])
    } as unknown as ImportService;

    snapTradeAlignmentService = new SnapTradeAlignmentService(
      {
        getActivitiesForPortfolioCalculator: jest.fn().mockResolvedValue({
          activities: [
            activity({
              date: '2026-01-05T00:00:00.000Z',
              quantity: 200,
              symbol: 'XEQT.TO',
              type: 'BUY',
              unitPrice: 35
            }),
            activity({
              date: '2026-11-09T00:00:00.000Z',
              quantity: 3,
              symbol: 'NVDA',
              type: 'BUY',
              unitPrice: 180
            })
          ]
        })
      } as unknown as ActivitiesService,
      {
        toCurrency: jest.fn().mockImplementation((value: number) => {
          return value / 1.4;
        })
      } as unknown as ExchangeRateDataService,
      importService,
      {
        snapTradePosition: {
          findMany: jest.fn().mockResolvedValue([
            {
              averagePrice: 35.05,
              currency: 'CAD',
              dataSource: DataSource.YAHOO,
              name: 'XEQT',
              price: 36.1,
              quantity: 200,
              symbol: 'XEQT.TO'
            },
            {
              // Reported in CAD, while the asset is in USD in Ghostfolio
              averagePrice: 263.326,
              currency: 'CAD',
              dataSource: DataSource.YAHOO,
              name: 'NVDA',
              price: 261.296,
              quantity: 3,
              symbol: 'NVDA'
            }
          ])
        }
      } as unknown as PrismaService,
      {} as UserService
    );
  });

  it('previews the corrections after the latest activity', async () => {
    const alignment = await snapTradeAlignmentService.getAlignment({
      snapTradeAccount,
      user
    });

    expect(alignment.date).toEqual(new Date('2026-11-09T00:00:01.000Z'));
    expect(alignment.corrections).toEqual([
      expect.objectContaining({
        activities: [
          { quantity: 3, type: 'SELL', unitPrice: 180 },
          { quantity: 3, type: 'BUY', unitPrice: expect.closeTo(188.09, 2) }
        ],
        currency: 'USD',
        symbol: 'NVDA'
      }),
      expect.objectContaining({
        activities: [
          { quantity: 200, type: 'SELL', unitPrice: 35 },
          { quantity: 200, type: 'BUY', unitPrice: 35.05 }
        ],
        symbol: 'XEQT.TO'
      })
    ]);
  });

  it('imports the activities of each correction together, one second apart', async () => {
    const result = await snapTradeAlignmentService.align({
      snapTradeAccount,
      user
    });

    expect(result).toEqual({ activities: 4, aligned: 2, failed: [] });
    expect(importService.import).toHaveBeenCalledTimes(2);

    const [{ activitiesDto }] = jest.mocked(importService.import).mock.calls[1];

    expect(activitiesDto).toEqual([
      expect.objectContaining({
        accountId: 'account-id',
        comment: expect.stringContaining(
          'SnapTrade alignment: 200 → 200 units, cost/unit 35 → 35.05 CAD'
        ),
        date: '2026-11-09T00:00:03.000Z',
        fee: 0,
        quantity: 200,
        symbol: 'XEQT.TO',
        type: 'SELL',
        unitPrice: 35
      }),
      expect.objectContaining({
        date: '2026-11-09T00:00:04.000Z',
        type: 'BUY',
        unitPrice: 35.05
      })
    ]);
  });

  it('reports a correction which cannot be imported', async () => {
    jest
      .mocked(importService.import)
      .mockRejectedValueOnce(new Error('Unknown symbol'));

    const result = await snapTradeAlignmentService.align({
      snapTradeAccount,
      user
    });

    expect(result).toEqual({
      activities: 2,
      aligned: 1,
      failed: [{ message: 'Unknown symbol', symbol: 'NVDA' }]
    });
  });

  it('refuses an account without positions', async () => {
    await expect(
      snapTradeAlignmentService.getAlignment({
        user,
        snapTradeAccount: { ...snapTradeAccount, positionsAsOf: null }
      })
    ).rejects.toThrow(SnapTradeAlignmentError);
  });
});
