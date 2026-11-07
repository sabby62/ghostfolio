import { CreateOrderDto } from '@ghostfolio/common/dtos';

import { DataSource, Type as ActivityType } from '@prisma/client';

/**
 * The subset of a SnapTrade activity (AccountUniversalActivity) which the
 * mapper reads
 */
export interface SnapTradeActivity {
  amount?: number | null;
  currency?: { code?: string } | null;
  description?: string;
  fee?: number;
  id?: string;
  option_symbol?: unknown;
  price?: number;
  settlement_date?: string;
  symbol?: {
    currency?: { code?: string };
    description?: string | null;
    symbol?: string;
    type?: { code?: string };
  } | null;
  trade_date?: string | null;
  type?: string;
  units?: number;
}

export type SnapTradeActivityMappingResult =
  | { activity: CreateOrderDto; activityId: string }
  | { activityId: string; reason: string };

const CASH_MOVEMENT_TYPES = ['CONTRIBUTION', 'TRANSFER', 'WITHDRAWAL'];

const COMMENT_PREFIX = 'SnapTrade';

// Security types which are not traded on an exchange that the data provider
// knows by the ticker
const UNSUPPORTED_SECURITY_TYPES = ['crypto'];

/**
 * Maps a SnapTrade activity to a Ghostfolio activity. SnapTrade follows the
 * ticker format of Yahoo Finance (e.g. XEQT.TO), which is the default data
 * source of the import.
 *
 * Cash movements (contributions, withdrawals and transfers) are no activities
 * in Ghostfolio, the cash balance of the account covers them.
 */
export function mapSnapTradeActivity({
  accountId,
  activity,
  dataSource
}: {
  accountId: string;
  activity: SnapTradeActivity;
  dataSource: DataSource;
}): SnapTradeActivityMappingResult {
  const activityId = activity.id;
  const type = activity.type?.toUpperCase();

  const skip = (reason: string): SnapTradeActivityMappingResult => {
    return { activityId, reason };
  };

  if (!activityId) {
    return skip('Missing identifier');
  }

  const dateString = activity.trade_date ?? activity.settlement_date;

  if (!dateString || isNaN(new Date(dateString).getTime())) {
    return skip('Missing date');
  }

  const date = new Date(dateString).toISOString();

  if (activity.option_symbol) {
    return skip('Options are not supported');
  }

  if (CASH_MOVEMENT_TYPES.includes(type)) {
    return skip('Cash movement (covered by the cash balance)');
  }

  const currency = (
    activity.currency?.code ?? activity.symbol?.currency?.code
  )?.toUpperCase();

  if (!currency) {
    return skip('Missing currency');
  }

  const amount = Math.abs(activity.amount ?? 0);
  const fee = Math.abs(activity.fee ?? 0);
  const comment = getComment(activity);

  switch (type) {
    case 'BUY':
    case 'REI':
    case 'SELL': {
      const symbol = activity.symbol?.symbol?.trim();

      if (!symbol) {
        return skip('Missing symbol');
      }

      if (
        UNSUPPORTED_SECURITY_TYPES.includes(
          activity.symbol?.type?.code?.toLowerCase()
        )
      ) {
        return skip(
          `Security type ${activity.symbol.type.code} is not supported`
        );
      }

      const quantity = Math.abs(activity.units ?? 0);

      if (quantity <= 0) {
        return skip('Missing quantity');
      }

      let unitPrice = Math.abs(activity.price ?? 0);

      if (unitPrice <= 0 && amount > 0) {
        unitPrice =
          type === 'SELL'
            ? (amount + fee) / quantity
            : Math.max(0, amount - fee) / quantity;
      }

      return {
        activityId,
        activity: {
          accountId,
          comment,
          currency,
          dataSource,
          date,
          fee,
          quantity,
          symbol,
          unitPrice,
          type: type === 'SELL' ? ActivityType.SELL : ActivityType.BUY
        }
      };
    }

    case 'DIVIDEND':
    case 'SUBSTITUTE_DIVIDEND': {
      const symbol = activity.symbol?.symbol?.trim();
      const dividend =
        amount > 0
          ? amount
          : Math.abs((activity.price ?? 0) * (activity.units ?? 0));

      if (!symbol) {
        return skip('Missing symbol');
      }

      if (dividend <= 0) {
        return skip('Missing amount');
      }

      return {
        activityId,
        activity: {
          accountId,
          comment,
          currency,
          dataSource,
          date,
          fee,
          symbol,
          quantity: 1,
          type: ActivityType.DIVIDEND,
          unitPrice: dividend
        }
      };
    }

    case 'FEE':
    case 'INTEREST':
    case 'TAX': {
      if (amount <= 0) {
        return skip('Missing amount');
      }

      // The data source is resolved in the import for these types, which
      // creates a custom asset profile with the symbol as its name
      return {
        activityId,
        activity: {
          accountId,
          comment,
          currency,
          date,
          fee: 0,
          quantity: 1,
          symbol:
            type === 'INTEREST' ? 'Interest' : type === 'TAX' ? 'Tax' : 'Fee',
          type: type === 'INTEREST' ? ActivityType.INTEREST : ActivityType.FEE,
          unitPrice: amount
        }
      };
    }

    default:
      return skip(`Type ${type ?? 'UNKNOWN'} is not supported`);
  }
}

function getComment({ description }: SnapTradeActivity) {
  const text = description?.replace(/\s+/g, ' ').trim();

  return text ? `${COMMENT_PREFIX}: ${text}`.slice(0, 500) : COMMENT_PREFIX;
}
