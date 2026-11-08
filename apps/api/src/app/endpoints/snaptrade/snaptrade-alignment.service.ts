import { CallerFacingError } from '@ghostfolio/api/errors/caller-facing.error';
import { ActivitiesService } from '@ghostfolio/api/services/activities/activities.service';
import { ExchangeRateDataService } from '@ghostfolio/api/services/exchange-rate-data/exchange-rate-data.service';
import { ImportService } from '@ghostfolio/api/services/import/import.service';
import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';
import { UserService } from '@ghostfolio/api/services/user/user.service';
import { DEFAULT_CURRENCY } from '@ghostfolio/common/config';
import { CreateOrderDto } from '@ghostfolio/common/dtos';
import { getAssetProfileIdentifier } from '@ghostfolio/common/helper';
import { UserWithSettings } from '@ghostfolio/common/types';

import { Injectable } from '@nestjs/common';
import { AssetSubClass, SnapTradeAccount } from '@prisma/client';
import { addSeconds } from 'date-fns';

import {
  AlignmentCorrection,
  AlignmentHolding,
  calculateAlignment,
  getHoldingsFromActivities
} from './snaptrade-alignment.calculator';

export interface SnapTradeAlignment {
  accountId: string;
  /** The time of the positions of the brokerage */
  asOf: Date;
  /** The date of the activities which align the holdings */
  date: Date;
  corrections: AlignmentCorrection[];
  snapTradeAccountId: string;
}

export interface SnapTradeAlignmentResult {
  /** Number of activities which are created */
  activities: number;
  /** Number of holdings which are aligned */
  aligned: number;
  failed: { message: string; symbol: string }[];
}

export class SnapTradeAlignmentError extends CallerFacingError {
  public constructor(message: string) {
    super(message);

    this.name = 'SnapTradeAlignmentError';
  }
}

export const ALIGNMENT_COMMENT_PREFIX = 'SnapTrade alignment';

/**
 * Aligns the holdings which Ghostfolio calculates from the activities of an
 * account with the positions which the brokerage reports, by adding buy and
 * sell activities. The activities never realize a gain, hence they change
 * the quantity and the cost of the holdings only.
 */
@Injectable()
export class SnapTradeAlignmentService {
  public constructor(
    private readonly activitiesService: ActivitiesService,
    private readonly exchangeRateDataService: ExchangeRateDataService,
    private readonly importService: ImportService,
    private readonly prismaService: PrismaService,
    private readonly userService: UserService
  ) {}

  public async align({
    snapTradeAccount,
    user
  }: {
    snapTradeAccount: SnapTradeAccount;
    user: UserWithSettings;
  }): Promise<SnapTradeAlignmentResult> {
    const { accountId, corrections, date } = await this.getAlignment({
      snapTradeAccount,
      user
    });

    const result: SnapTradeAlignmentResult = {
      activities: 0,
      aligned: 0,
      failed: []
    };

    let time = date;

    for (const correction of corrections) {
      if (correction.activities.length === 0) {
        continue;
      }

      // The activities of a correction must be applied in this order, hence
      // each one is a second later than the previous one
      const activitiesDto = correction.activities.map(
        ({ quantity, type, unitPrice }): CreateOrderDto => {
          const activity: CreateOrderDto = {
            accountId,
            quantity,
            type,
            unitPrice,
            comment: this.getComment(correction),
            currency: correction.currency,
            dataSource: correction.dataSource,
            date: time.toISOString(),
            fee: 0,
            symbol: correction.symbol
          };

          time = addSeconds(time, 1);

          return activity;
        }
      );

      try {
        // The import validates all activities before it persists one, hence
        // the activities of a correction are imported together or not at all
        await this.importService.import({
          activitiesDto,
          user,
          accountsWithBalancesDto: [],
          assetProfilesWithMarketDataDto: [],
          platformsDto: [],
          tagsDto: []
        });

        result.activities += activitiesDto.length;
        result.aligned++;
      } catch (error) {
        result.failed.push({
          message: (error as Error).message,
          symbol: correction.symbol
        });
      }
    }

    return result;
  }

  public async getAlignment({
    snapTradeAccount,
    user
  }: {
    snapTradeAccount: SnapTradeAccount;
    user: UserWithSettings;
  }): Promise<SnapTradeAlignment> {
    if (!snapTradeAccount.accountId) {
      throw new SnapTradeAlignmentError(
        'Link the brokerage account to an account first'
      );
    }

    if (!snapTradeAccount.positionsAsOf) {
      throw new SnapTradeAlignmentError(
        'Sync the brokerage account first to get its positions'
      );
    }

    const userCurrency =
      user.settings?.settings?.baseCurrency ?? DEFAULT_CURRENCY;

    const [{ activities }, positions] = await Promise.all([
      this.activitiesService.getActivitiesForPortfolioCalculator({
        userCurrency,
        filters: [{ id: snapTradeAccount.accountId, type: 'ACCOUNT' }],
        userId: user.id,
        withExcludedAccountsAndActivities: true
      }),
      this.prismaService.snapTradePosition.findMany({
        where: { snapTradeAccountId: snapTradeAccount.id }
      })
    ]);

    const ghostfolio = getHoldingsFromActivities(
      activities
        .filter(({ assetProfile }) => {
          return assetProfile.assetSubClass !== AssetSubClass.CASH;
        })
        .sort((a, b) => {
          return new Date(a.date).getTime() - new Date(b.date).getTime();
        })
        .map(
          ({
            assetProfile,
            quantity,
            type,
            unitPriceInAssetProfileCurrency
          }) => {
            return {
              quantity,
              type,
              currency: assetProfile.currency,
              dataSource: assetProfile.dataSource,
              name: assetProfile.name,
              symbol: assetProfile.symbol,
              unitPrice: unitPriceInAssetProfileCurrency
            };
          }
        )
    );

    const ghostfolioCurrencyByIdentifier = new Map(
      ghostfolio.map(({ currency, dataSource, symbol }) => {
        return [getAssetProfileIdentifier({ dataSource, symbol }), currency];
      })
    );

    const broker = positions.map((position): AlignmentHolding => {
      // The prices in the currency of the asset in Ghostfolio
      const currency =
        ghostfolioCurrencyByIdentifier.get(
          getAssetProfileIdentifier(position)
        ) ?? position.currency;

      const toCurrency = (value: number) => {
        return currency === position.currency
          ? value
          : this.exchangeRateDataService.toCurrency(
              value,
              position.currency,
              currency
            );
      };

      return {
        currency,
        averagePrice:
          position.averagePrice === null
            ? null
            : toCurrency(position.averagePrice),
        dataSource: position.dataSource,
        marketPrice: toCurrency(position.price),
        name: position.name,
        quantity: position.quantity,
        symbol: position.symbol
      };
    });

    // After the latest activity, hence the corrections apply to the holdings
    // as they are now
    const latestActivityTime = Math.max(
      0,
      ...activities.map(({ date }) => {
        return new Date(date).getTime();
      })
    );

    const date = new Date(
      Math.max(
        snapTradeAccount.positionsAsOf.getTime(),
        latestActivityTime + 1000
      )
    );

    date.setMilliseconds(0);

    return {
      date,
      accountId: snapTradeAccount.accountId,
      asOf: snapTradeAccount.positionsAsOf,
      corrections: calculateAlignment({ broker, ghostfolio }),
      snapTradeAccountId: snapTradeAccount.id
    };
  }

  /**
   * Finds the SnapTrade account of a user
   */
  public async getSnapTradeAccount({
    snapTradeAccountId,
    userId
  }: {
    snapTradeAccountId: string;
    userId: string;
  }) {
    const snapTradeAccount =
      await this.prismaService.snapTradeAccount.findFirst({
        where: { connection: { userId }, id: snapTradeAccountId }
      });

    const user = snapTradeAccount
      ? await this.userService.user({ id: userId })
      : null;

    return { snapTradeAccount, user };
  }

  private getComment({ after, before, currency }: AlignmentCorrection) {
    const formatPrice = (value: number | null) => {
      return value === null ? '–' : value.toFixed(4).replace(/\.?0+$/, '');
    };

    const formatQuantity = (value: number) => {
      return Number(value.toFixed(6)).toString();
    };

    return `${ALIGNMENT_COMMENT_PREFIX}: ${formatQuantity(before.quantity)} → ${formatQuantity(after.quantity)} units, cost/unit ${formatPrice(
      before.averagePrice
    )} → ${formatPrice(after.averagePrice)} ${currency} as reported by the brokerage`;
  }
}
