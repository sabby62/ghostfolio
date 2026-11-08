import {
  BrokerHoldings,
  SnapTradeHoldingsService
} from '@ghostfolio/api/app/endpoints/snaptrade/snaptrade-holdings.service';
import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';
import { CallerFacingError } from '@ghostfolio/api/errors/caller-facing.error';
import { ApiService } from '@ghostfolio/api/services/api/api.service';
import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';
import { DataProviderService } from '@ghostfolio/api/services/data-provider/data-provider.service';
import { ExchangeRateDataService } from '@ghostfolio/api/services/exchange-rate-data/exchange-rate-data.service';
import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';
import { UserService } from '@ghostfolio/api/services/user/user.service';

import { AssetSubClass, DataSource } from '@prisma/client';

import {
  RebalancingGroupNotFoundError,
  RebalancingService
} from './rebalancing.service';

describe('RebalancingService', () => {
  const userId = 'user-id';

  const group = {
    accountIds: ['account-id'],
    createdAt: new Date(),
    driftThresholdInPercentage: 0.05,
    id: 'group-id',
    name: 'TFSA',
    targets: [
      {
        dataSource: DataSource.YAHOO,
        groupId: 'group-id',
        id: 'target-1',
        symbol: 'XEQT.TO',
        targetInPercentage: 0.5
      },
      {
        dataSource: DataSource.YAHOO,
        groupId: 'group-id',
        id: 'target-2',
        symbol: 'VFV',
        targetInPercentage: 0.5
      }
    ],
    updatedAt: new Date(),
    userId
  };

  let apiService: ApiService;
  let dataProviderService: DataProviderService;
  let exchangeRateDataService: ExchangeRateDataService;
  let portfolioService: PortfolioService;
  let prismaService: PrismaService;
  let rebalancingService: RebalancingService;
  let snapTradeHoldingsService: SnapTradeHoldingsService;

  const noBrokerHoldings: BrokerHoldings = {
    accountIds: [],
    asOf: null,
    cash: [],
    positions: []
  };

  beforeEach(() => {
    apiService = {
      buildFiltersFromQueryParams: jest
        .fn()
        .mockReturnValue([{ id: 'account-id', type: 'ACCOUNT' }])
    } as unknown as ApiService;

    dataProviderService = {
      getQuotes: jest.fn().mockResolvedValue({
        'YAHOO-VFV': { currency: 'USD', marketPrice: 100 }
      })
    } as unknown as DataProviderService;

    exchangeRateDataService = {
      toCurrency: jest.fn().mockImplementation((value: number) => {
        return value * 1.4;
      })
    } as unknown as ExchangeRateDataService;

    portfolioService = {
      getDetails: jest.fn().mockResolvedValue({
        holdings: [
          {
            assetProfile: {
              assetSubClass: AssetSubClass.ETF,
              currency: 'CAD',
              dataSource: DataSource.YAHOO,
              name: 'iShares Core Equity ETF Portfolio',
              symbol: 'XEQT.TO'
            },
            quantity: 100,
            valueInBaseCurrency: 3500
          },
          {
            assetProfile: {
              assetSubClass: AssetSubClass.CASH,
              currency: 'CAD',
              dataSource: DataSource.MANUAL,
              symbol: 'CAD'
            },
            quantity: 1500,
            valueInBaseCurrency: 1500
          }
        ]
      })
    } as unknown as PortfolioService;

    prismaService = {
      $transaction: jest.fn().mockImplementation((callback) => {
        return callback(prismaService);
      }),
      account: { findMany: jest.fn().mockResolvedValue([]) },
      rebalancingGroup: {
        create: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(group),
        update: jest.fn().mockResolvedValue(group)
      },
      rebalancingTarget: { deleteMany: jest.fn() }
    } as unknown as PrismaService;

    snapTradeHoldingsService = {
      getBrokerHoldings: jest.fn().mockResolvedValue(noBrokerHoldings)
    } as unknown as SnapTradeHoldingsService;

    rebalancingService = new RebalancingService(
      apiService,
      {
        get: jest.fn().mockReturnValue(false)
      } as unknown as ConfigurationService,
      dataProviderService,
      exchangeRateDataService,
      portfolioService,
      prismaService,
      snapTradeHoldingsService,
      {
        user: jest.fn().mockResolvedValue({
          id: userId,
          settings: { settings: { baseCurrency: 'CAD' } }
        })
      } as unknown as UserService
    );
  });

  it('gives the drift with the cash and a quote for a target not held', async () => {
    const drift = await rebalancingService.getDrift({ userId, id: 'group-id' });

    expect(apiService.buildFiltersFromQueryParams).toHaveBeenCalledWith({
      filterByAccounts: ['account-id']
    });
    expect(dataProviderService.getQuotes).toHaveBeenCalledWith({
      items: [{ dataSource: DataSource.YAHOO, symbol: 'VFV' }]
    });

    expect(drift.baseCurrency).toBe('CAD');
    expect(drift.totalValueInBaseCurrency).toBe(5000);
    expect(drift.cash.valueInBaseCurrency).toBe(1500);
    expect(drift.positions).toHaveLength(2);
    expect(drift.holdingsSource).toEqual({
      asOf: null,
      brokerAccountIds: [],
      source: 'GHOSTFOLIO'
    });
  });

  it('takes the holdings of a synced account as reported by the brokerage', async () => {
    const asOf = new Date('2026-11-08T00:22:44Z');

    jest.mocked(snapTradeHoldingsService.getBrokerHoldings).mockResolvedValue({
      asOf,
      accountIds: ['account-id'],
      cash: [{ amount: 1000, currency: 'CAD', valueInBaseCurrency: 1000 }],
      positions: [
        {
          averagePrice: 30,
          currency: 'CAD',
          dataSource: DataSource.YAHOO,
          investmentInBaseCurrency: 1500,
          marketPrice: 40,
          name: 'iShares Core Equity ETF Portfolio',
          quantity: 50,
          symbol: 'XEQT.TO',
          valueInBaseCurrency: 2000
        }
      ]
    });

    const drift = await rebalancingService.getDrift({ userId, id: 'group-id' });

    expect(snapTradeHoldingsService.getBrokerHoldings).toHaveBeenCalledWith({
      userId,
      accountIds: ['account-id'],
      baseCurrency: 'CAD'
    });
    expect(portfolioService.getDetails).not.toHaveBeenCalled();
    expect(drift.holdingsSource).toEqual({
      asOf,
      brokerAccountIds: ['account-id'],
      source: 'BROKER'
    });
    expect(drift.totalValueInBaseCurrency).toBe(3000);
    expect(drift.cash.valueInBaseCurrency).toBe(1000);
    expect(drift.positions).toContainEqual(
      expect.objectContaining({
        gainInBaseCurrency: 500,
        quantity: 50,
        symbol: 'XEQT.TO'
      })
    );
  });

  it('combines the brokerage with the other accounts of a group', async () => {
    jest.spyOn(prismaService.rebalancingGroup, 'findFirst').mockResolvedValue({
      ...group,
      accountIds: ['account-id', 'other-account-id']
    });

    jest.mocked(snapTradeHoldingsService.getBrokerHoldings).mockResolvedValue({
      ...noBrokerHoldings,
      accountIds: ['account-id'],
      positions: [
        {
          averagePrice: null,
          currency: 'CAD',
          dataSource: DataSource.YAHOO,
          investmentInBaseCurrency: null,
          marketPrice: 35,
          name: null,
          quantity: 100,
          symbol: 'XEQT.TO',
          valueInBaseCurrency: 3500
        }
      ]
    });

    const drift = await rebalancingService.getDrift({ userId, id: 'group-id' });

    expect(apiService.buildFiltersFromQueryParams).toHaveBeenCalledWith({
      filterByAccounts: ['other-account-id']
    });
    expect(drift.holdingsSource.source).toBe('MIXED');
    // XEQT.TO of both sources (3500 + 3500) and the cash (1500)
    expect(drift.totalValueInBaseCurrency).toBe(8500);
    expect(drift.positions).toContainEqual(
      expect.objectContaining({ quantity: 200, symbol: 'XEQT.TO' })
    );
  });

  it('calculates the trades with the price of the quote in base currency', async () => {
    const plan = await rebalancingService.calculate({
      userId,
      data: {},
      id: 'group-id'
    });

    // Total 5000: VFV target 2500 at 140 CAD (100 USD), XEQT target 2500
    expect(plan.mode).toBe('BUY_ONLY');
    expect(plan.trades).toEqual([
      expect.objectContaining({
        action: 'BUY',
        priceInBaseCurrency: 140,
        quantity: 10,
        symbol: 'VFV'
      })
    ]);
    expect(plan.cashAfterInBaseCurrency).toBe(100);
  });

  it('refuses a group of another user', async () => {
    jest
      .spyOn(prismaService.rebalancingGroup, 'findFirst')
      .mockResolvedValue(null);

    await expect(
      rebalancingService.getDrift({ userId, id: 'group-id' })
    ).rejects.toThrow(RebalancingGroupNotFoundError);

    expect(prismaService.rebalancingGroup.findFirst).toHaveBeenCalledWith({
      include: { targets: true },
      where: { userId, id: 'group-id' }
    });
  });

  it('refuses an account of another user', async () => {
    await expect(
      rebalancingService.createGroup({
        userId,
        data: {
          accountIds: ['foreign-account-id'],
          name: 'TFSA',
          targets: []
        }
      })
    ).rejects.toThrow(CallerFacingError);

    expect(prismaService.rebalancingGroup.create).not.toHaveBeenCalled();
  });

  it('refuses targets above 100%', async () => {
    await expect(
      rebalancingService.createGroup({
        userId,
        data: {
          name: 'TFSA',
          targets: [
            {
              dataSource: DataSource.YAHOO,
              symbol: 'XEQT.TO',
              targetInPercentage: 0.8
            },
            {
              dataSource: DataSource.YAHOO,
              symbol: 'VFV',
              targetInPercentage: 0.3
            }
          ]
        }
      })
    ).rejects.toThrow('must not exceed 1');

    expect(prismaService.rebalancingGroup.create).not.toHaveBeenCalled();
  });

  it('refuses an invalid data source', async () => {
    await expect(
      rebalancingService.createGroup({
        userId,
        data: {
          name: 'TFSA',
          targets: [
            {
              dataSource: 'INVALID',
              symbol: 'XEQT.TO',
              targetInPercentage: 1
            }
          ]
        }
      })
    ).rejects.toThrow('The data source of XEQT.TO is not valid');
  });

  it('deletes the old targets before it creates the new targets', async () => {
    await rebalancingService.updateGroup({
      userId,
      data: {
        targets: [
          {
            dataSource: DataSource.YAHOO,
            symbol: 'XEQT.TO',
            targetInPercentage: 1
          }
        ]
      },
      id: 'group-id'
    });

    const deleteOrder = jest.mocked(prismaService.rebalancingTarget.deleteMany)
      .mock.invocationCallOrder[0];
    const updateOrder = jest.mocked(prismaService.rebalancingGroup.update).mock
      .invocationCallOrder[0];

    expect(prismaService.rebalancingTarget.deleteMany).toHaveBeenCalledWith({
      where: { groupId: 'group-id' }
    });
    expect(deleteOrder).toBeLessThan(updateOrder);
    expect(prismaService.rebalancingGroup.update).toHaveBeenCalledWith({
      data: {
        targets: {
          create: [
            {
              dataSource: DataSource.YAHOO,
              symbol: 'XEQT.TO',
              targetInPercentage: 1
            }
          ]
        }
      },
      include: { targets: true },
      where: { id: 'group-id' }
    });
  });

  it('keeps the targets if no targets are given', async () => {
    await rebalancingService.updateGroup({
      userId,
      data: { name: 'RRSP' },
      id: 'group-id'
    });

    expect(prismaService.rebalancingTarget.deleteMany).not.toHaveBeenCalled();
  });
});
