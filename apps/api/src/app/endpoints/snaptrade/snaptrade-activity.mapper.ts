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
    exchange?: { suffix?: string | null } | null;
    raw_symbol?: string;
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

// Cash movements and conversions between the currencies of the account (FXT)
// and the daily cash adjustments of short positions (MKT, mark to market)
const CASH_MOVEMENT_TYPES = [
  'CONTRIBUTION',
  'FXT',
  'MKT',
  'TRANSFER',
  'WITHDRAWAL'
];

// Positions which move between accounts or between the listings of a
// security, e.g. BRW (journal) of Questrade from DLR.TO to DLR.U.TO
const POSITION_TRANSFER_TYPES = [
  'BRW',
  'INTERNAL_ASSET_TRANSFER_IN',
  'INTERNAL_ASSET_TRANSFER_OUT',
  'TRANSFER'
];

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

  const isPositionTransfer =
    POSITION_TRANSFER_TYPES.includes(type) &&
    !!activity.symbol?.symbol &&
    Math.abs(activity.units ?? 0) > 0;

  if (CASH_MOVEMENT_TYPES.includes(type) && !isPositionTransfer) {
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

  if (isPositionTransfer) {
    // Ghostfolio has no transfer of a position, hence it is recorded as a sell
    // in the source and as a buy in the target at the book value, which
    // realizes no gain
    const symbol = getYahooFinanceSymbol(activity.symbol);
    const quantity = Math.abs(activity.units);
    const unitPrice =
      Math.abs(activity.price ?? 0) > 0
        ? Math.abs(activity.price)
        : amount / quantity;

    if (!(unitPrice > 0)) {
      return skip(
        'Transfer of a position without book value (record it manually)'
      );
    }

    return {
      activityId,
      activity: {
        accountId,
        comment,
        currency,
        dataSource,
        date,
        quantity,
        symbol,
        unitPrice,
        fee: 0,
        type: activity.units < 0 ? ActivityType.SELL : ActivityType.BUY
      }
    };
  }

  switch (type) {
    case 'BUY':
    case 'REI':
    case 'SELL': {
      const symbol = getYahooFinanceSymbol(activity.symbol);

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
      const symbol = getYahooFinanceSymbol(activity.symbol);
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

    case 'FCH':
    case 'FEE':
    case 'INTEREST':
    case 'TAX': {
      if (amount <= 0) {
        return skip('Missing amount');
      }

      // The data source is resolved in the import for these types, which
      // creates a custom asset profile with the symbol as its name
      if (type === 'INTEREST') {
        return {
          activityId,
          activity: {
            accountId,
            comment,
            currency,
            date,
            fee: 0,
            quantity: 1,
            symbol: 'Interest',
            type: ActivityType.INTEREST,
            unitPrice: amount
          }
        };
      }

      // Ghostfolio counts the fee of a fee activity, like its activity form
      return {
        activityId,
        activity: {
          accountId,
          comment,
          currency,
          date,
          fee: amount,
          quantity: 0,
          symbol: type === 'TAX' ? 'Tax' : 'Fee',
          type: ActivityType.FEE,
          unitPrice: 0
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

/**
 * Gives the price of the journals (BRW) of Questrade, which move a position
 * between the listings of a security in two currencies (e.g. DLR.TO in CAD to
 * DLR.U.TO in USD, Norbert's gambit) without price. The incoming journal has
 * the book value in CAD and the exchange rate in its description, e.g.
 * "JOURNAL POSITION FROM CAD BOOK VALUE: $5132.22 CNV@ 1.3747", the outgoing
 * journal of the same day and quantity gets the same book value.
 */
export function enrichJournalActivities(
  activities: SnapTradeActivity[]
): SnapTradeActivity[] {
  const enrichedActivities = activities.map((activity) => {
    return { ...activity };
  });

  const journals = enrichedActivities.filter(({ price, type, units }) => {
    return type?.toUpperCase() === 'BRW' && !(price > 0) && units;
  });

  for (const incoming of journals) {
    const bookValue = parseNumber(
      /BOOK VALUE:?\s*\$?\s*([\d,]+(?:\.\d+)?)/i.exec(
        incoming.description ?? ''
      )?.[1]
    );

    if (!(incoming.units > 0) || !(bookValue > 0)) {
      continue;
    }

    const exchangeRate = parseNumber(
      /CNV@\s*([\d.]+)/i.exec(incoming.description ?? '')?.[1]
    );

    const getPrice = (activity: SnapTradeActivity) => {
      const currency = (
        activity.currency?.code ?? activity.symbol?.currency?.code
      )?.toUpperCase();
      const quantity = Math.abs(activity.units);

      if (currency === 'CAD') {
        return bookValue / quantity;
      }

      return exchangeRate > 0 ? bookValue / exchangeRate / quantity : undefined;
    };

    incoming.price = getPrice(incoming);

    const outgoing = journals.find((journal) => {
      return (
        journal !== incoming &&
        journal.units === -incoming.units &&
        !(journal.price > 0) &&
        getDay(journal) === getDay(incoming)
      );
    });

    if (outgoing) {
      outgoing.price = getPrice(outgoing);
    }
  }

  return enrichedActivities;
}

/**
 * Gives the ticker of Yahoo Finance, which writes the class of a share with a
 * hyphen (DLR-U.TO, BRK-B), while SnapTrade writes it with a dot (DLR.U.TO,
 * BRK.B)
 */
export function getYahooFinanceSymbol(symbol: SnapTradeActivity['symbol']) {
  const ticker = symbol?.symbol?.trim();

  if (!ticker) {
    return undefined;
  }

  if (!symbol.raw_symbol && !symbol.exchange) {
    // Without the exchange, the suffix cannot be told apart from the class
    return ticker;
  }

  const suffix = symbol.exchange?.suffix?.replace(/^\./, '').trim();

  let base = symbol.raw_symbol?.trim();

  if (!base) {
    base =
      suffix && ticker.toUpperCase().endsWith(`.${suffix.toUpperCase()}`)
        ? ticker.slice(0, -(suffix.length + 1))
        : ticker;
  }

  base = base.replace(/\./g, '-');

  return suffix ? `${base}.${suffix}` : base;
}

function getDay({ settlement_date, trade_date }: SnapTradeActivity) {
  return (trade_date ?? settlement_date ?? '').slice(0, 10);
}

function parseNumber(value?: string) {
  return value ? Number(value.replace(/,/g, '')) : undefined;
}
