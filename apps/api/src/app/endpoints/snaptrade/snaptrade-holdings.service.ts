import { DataProviderService } from '@ghostfolio/api/services/data-provider/data-provider.service';
import { ExchangeRateDataService } from '@ghostfolio/api/services/exchange-rate-data/exchange-rate-data.service';
import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';
import { UserService } from '@ghostfolio/api/services/user/user.service';
import { DEFAULT_CURRENCY } from '@ghostfolio/common/config';
import { getAssetProfileIdentifier } from '@ghostfolio/common/helper';
import { PortfolioPosition } from '@ghostfolio/common/interfaces';

import { Injectable } from '@nestjs/common';
import { AssetClass, AssetSubClass, DataSource } from '@prisma/client';

export interface SnapTradeCashBalance {
  amount: number;
  currency: string;
}

export interface BrokerHoldingPosition {
  /** Average cost per unit in the currency of the position */
  averagePrice: number | null;
  currency: string;
  dataSource: DataSource;
  /** Cost in the base currency at the current exchange rate, null if unknown */
  investmentInBaseCurrency: number | null;
  /** Market price per unit in the currency of the position */
  marketPrice: number;
  name: string | null;
  quantity: number;
  symbol: string;
  valueInBaseCurrency: number;
}

export interface BrokerHoldings {
  /** The Ghostfolio accounts of which the brokerage reports the positions */
  accountIds: string[];
  /** The oldest time of the data of the brokerages */
  asOf: Date | null;
  cash: (SnapTradeCashBalance & { valueInBaseCurrency: number })[];
  positions: BrokerHoldingPosition[];
}

/**
 * Provides the holdings as reported by the brokerages, which SnapTrade syncs
 * into Ghostfolio. These numbers match the ones of the brokerages, while the
 * holdings of Ghostfolio are calculated from the history of the activities.
 */
@Injectable()
export class SnapTradeHoldingsService {
  public constructor(
    private readonly dataProviderService: DataProviderService,
    private readonly exchangeRateDataService: ExchangeRateDataService,
    private readonly prismaService: PrismaService,
    private readonly userService: UserService
  ) {}

  public async getBrokerHoldings({
    accountIds,
    baseCurrency,
    userId
  }: {
    accountIds?: string[];
    baseCurrency: string;
    userId: string;
  }): Promise<BrokerHoldings> {
    const snapTradeAccounts =
      await this.prismaService.snapTradeAccount.findMany({
        include: { positions: true },
        where: {
          accountUserId: userId,
          connection: { userId },
          positionsAsOf: { not: null },
          ...(accountIds?.length
            ? { accountId: { in: accountIds } }
            : { accountId: { not: null } })
        }
      });

    const cashByCurrency = new Map<string, number>();
    const positionsByIdentifier = new Map<string, BrokerHoldingPosition>();
    let asOf: Date | null = null;

    for (const snapTradeAccount of snapTradeAccounts) {
      if (
        snapTradeAccount.positionsAsOf &&
        (!asOf || snapTradeAccount.positionsAsOf < asOf)
      ) {
        asOf = snapTradeAccount.positionsAsOf;
      }

      for (const { amount, currency } of this.parseCashBalances(
        snapTradeAccount.cashBalances
      )) {
        cashByCurrency.set(
          currency,
          (cashByCurrency.get(currency) ?? 0) + amount
        );
      }

      for (const position of snapTradeAccount.positions) {
        const valueInBaseCurrency = this.exchangeRateDataService.toCurrency(
          position.quantity * position.price,
          position.currency,
          baseCurrency
        );

        const investmentInBaseCurrency =
          position.averagePrice === null
            ? null
            : this.exchangeRateDataService.toCurrency(
                position.quantity * position.averagePrice,
                position.currency,
                baseCurrency
              );

        const identifier = getAssetProfileIdentifier({
          dataSource: position.dataSource,
          symbol: position.symbol
        });

        const existing = positionsByIdentifier.get(identifier);

        if (existing) {
          const quantity = existing.quantity + position.quantity;

          existing.averagePrice =
            existing.averagePrice !== null && position.averagePrice !== null
              ? (existing.averagePrice * existing.quantity +
                  position.averagePrice * position.quantity) /
                quantity
              : null;
          existing.investmentInBaseCurrency =
            existing.investmentInBaseCurrency !== null &&
            investmentInBaseCurrency !== null
              ? existing.investmentInBaseCurrency + investmentInBaseCurrency
              : null;
          existing.quantity = quantity;
          existing.valueInBaseCurrency += valueInBaseCurrency;
        } else {
          positionsByIdentifier.set(identifier, {
            investmentInBaseCurrency,
            valueInBaseCurrency,
            averagePrice: position.averagePrice,
            currency: position.currency,
            dataSource: position.dataSource,
            marketPrice: position.price,
            name: position.name,
            quantity: position.quantity,
            symbol: position.symbol
          });
        }
      }
    }

    return {
      asOf,
      accountIds: snapTradeAccounts.map(({ accountId }) => {
        return accountId;
      }),
      cash: [...cashByCurrency.entries()]
        .filter(([, amount]) => {
          return amount !== 0;
        })
        .map(([currency, amount]) => {
          return {
            amount,
            currency,
            valueInBaseCurrency: this.exchangeRateDataService.toCurrency(
              amount,
              currency,
              baseCurrency
            )
          };
        }),
      positions: [...positionsByIdentifier.values()]
    };
  }

  /**
   * Returns the holdings as reported by the brokerages in the format of the
   * holdings of Ghostfolio
   */
  public async getHoldings({
    accountIds,
    assetClasses,
    userId
  }: {
    accountIds?: string[];
    assetClasses?: string[];
    userId: string;
  }): Promise<{ asOf: Date | null; holdings: PortfolioPosition[] }> {
    const user = await this.userService.user({ id: userId });
    const baseCurrency =
      user?.settings?.settings?.baseCurrency ?? DEFAULT_CURRENCY;

    const { asOf, cash, positions } = await this.getBrokerHoldings({
      accountIds,
      baseCurrency,
      userId
    });

    const symbolProfiles =
      positions.length > 0
        ? await this.prismaService.symbolProfile.findMany({
            select: {
              assetClass: true,
              assetSubClass: true,
              countries: true,
              dataSource: true,
              isin: true,
              name: true,
              sectors: true,
              symbol: true,
              url: true
            },
            where: {
              OR: positions.map(({ dataSource, symbol }) => {
                return { dataSource, symbol };
              })
            }
          })
        : [];

    const symbolProfileByIdentifier = new Map(
      symbolProfiles.map((symbolProfile) => {
        return [getAssetProfileIdentifier(symbolProfile), symbolProfile];
      })
    );

    let holdings: PortfolioPosition[] = positions.map((position) => {
      const symbolProfile = symbolProfileByIdentifier.get(
        getAssetProfileIdentifier(position)
      );

      const netPerformance =
        position.investmentInBaseCurrency === null
          ? 0
          : position.valueInBaseCurrency - position.investmentInBaseCurrency;

      const netPerformancePercent =
        position.investmentInBaseCurrency > 0
          ? netPerformance / position.investmentInBaseCurrency
          : 0;

      return {
        activitiesCount: 0,
        allocationInPercentage: 0,
        assetProfile: {
          assetClass: symbolProfile?.assetClass ?? undefined,
          assetSubClass: symbolProfile?.assetSubClass ?? undefined,
          countries: (symbolProfile?.countries as never) ?? [],
          currency: position.currency,
          dataSource: position.dataSource,
          holdings: [],
          isin: symbolProfile?.isin ?? undefined,
          name: symbolProfile?.name ?? position.name ?? position.symbol,
          sectors: (symbolProfile?.sectors as never) ?? [],
          symbol: position.symbol,
          url: symbolProfile?.url ?? undefined
        },
        averagePrice: position.averagePrice ?? undefined,
        dateOfFirstActivity: undefined,
        dividend: 0,
        grossPerformance: netPerformance,
        grossPerformancePercent: netPerformancePercent,
        grossPerformancePercentWithCurrencyEffect: netPerformancePercent,
        grossPerformanceWithCurrencyEffect: netPerformance,
        investment: position.investmentInBaseCurrency ?? 0,
        investmentWithCurrencyEffect:
          position.investmentInBaseCurrency ?? undefined,
        marketPrice: position.marketPrice,
        netPerformance,
        netPerformancePercent,
        netPerformancePercentWithCurrencyEffect: netPerformancePercent,
        netPerformanceWithCurrencyEffect: netPerformance,
        quantity: position.quantity,
        tags: [],
        valueInBaseCurrency: position.valueInBaseCurrency
      };
    });

    holdings.push(
      ...cash.map(({ amount, currency, valueInBaseCurrency }) => {
        return {
          activitiesCount: 0,
          allocationInPercentage: 0,
          assetProfile: {
            currency,
            assetClass: AssetClass.LIQUIDITY,
            assetSubClass: AssetSubClass.CASH,
            countries: [],
            dataSource:
              this.dataProviderService.getDataSourceForExchangeRates(),
            holdings: [],
            name: currency,
            sectors: [],
            symbol: currency
          },
          dateOfFirstActivity: undefined,
          dividend: 0,
          grossPerformance: 0,
          grossPerformancePercent: 0,
          grossPerformancePercentWithCurrencyEffect: 0,
          grossPerformanceWithCurrencyEffect: 0,
          investment: valueInBaseCurrency,
          marketPrice: 0,
          netPerformance: 0,
          netPerformancePercent: 0,
          netPerformancePercentWithCurrencyEffect: 0,
          netPerformanceWithCurrencyEffect: 0,
          quantity: amount,
          tags: [],
          valueInBaseCurrency
        } as PortfolioPosition;
      })
    );

    if (assetClasses?.length) {
      holdings = holdings.filter(({ assetProfile }) => {
        return assetClasses.includes(assetProfile.assetClass);
      });
    }

    const totalValueInBaseCurrency = holdings.reduce(
      (sum, { valueInBaseCurrency }) => {
        return sum + (valueInBaseCurrency ?? 0);
      },
      0
    );

    for (const holding of holdings) {
      holding.allocationInPercentage =
        totalValueInBaseCurrency > 0
          ? (holding.valueInBaseCurrency ?? 0) / totalValueInBaseCurrency
          : 0;
    }

    holdings.sort((a, b) => {
      return (b.valueInBaseCurrency ?? 0) - (a.valueInBaseCurrency ?? 0);
    });

    return { asOf, holdings };
  }

  private parseCashBalances(value: unknown): SnapTradeCashBalance[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((item): item is SnapTradeCashBalance => {
      return (
        typeof item?.amount === 'number' &&
        typeof item?.currency === 'string' &&
        item.currency.length > 0
      );
    });
  }
}
