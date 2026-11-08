import { DataSource } from '@prisma/client';

import { getYahooFinanceSymbol } from './snaptrade-activity.mapper';

/**
 * The subset of a SnapTrade position (AccountPosition) which is mapped
 */
export interface SnapTradePositionInput {
  cash_equivalent?: boolean;
  cost_basis?: string | null;
  currency?: string | null;
  instrument?: {
    currency?: string | null;
    description?: string | null;
    exchange?: string | null;
    kind?: string;
    raw_symbol?: string | null;
    symbol?: string | null;
  };
  price?: string | null;
  units?: string | null;
}

export interface SnapTradePositionData {
  /** Average cost per unit in the currency of the position */
  averagePrice: number | null;
  currency: string;
  dataSource: DataSource;
  kind: string | null;
  name: string | null;
  /** Market price per unit in the currency of the position */
  price: number;
  quantity: number;
  symbol: string;
}

export type SnapTradePositionMappingResult =
  SnapTradePositionData | { reason: string; symbol?: string };

/**
 * Derivatives and bonds are quoted per contract or per 100 of nominal value,
 * hence their value cannot be calculated as units times price
 */
const UNSUPPORTED_KINDS = [
  'bond',
  'cash',
  'cfd',
  'future',
  'future_option',
  'option',
  'tokenized_asset'
];

export function mapSnapTradePosition({
  dataSource,
  position
}: {
  dataSource: DataSource;
  position: SnapTradePositionInput;
}): SnapTradePositionMappingResult {
  const instrument = position.instrument ?? {};
  const kind = instrument.kind?.toLowerCase() ?? null;
  const ticker = instrument.symbol?.trim();

  if (!ticker) {
    return { reason: 'Missing symbol' };
  }

  if (position.cash_equivalent) {
    // Already part of the cash balance of the account
    return { reason: 'Cash equivalent (covered by the cash balance)' };
  }

  if (kind && UNSUPPORTED_KINDS.includes(kind)) {
    return {
      reason: `Instrument kind ${kind} is not supported`,
      symbol: ticker
    };
  }

  const quantity = parseNumber(position.units);

  if (!quantity || quantity <= 0) {
    return { reason: 'No long position', symbol: ticker };
  }

  const currency = (
    position.currency ??
    instrument.currency ??
    ''
  ).toUpperCase();

  if (!currency) {
    return { reason: 'Missing currency', symbol: ticker };
  }

  const price = parseNumber(position.price) ?? 0;
  const averagePrice = parseNumber(position.cost_basis);

  return {
    currency,
    dataSource,
    kind,
    price,
    quantity,
    averagePrice:
      averagePrice !== undefined && averagePrice >= 0 ? averagePrice : null,
    name: instrument.description?.trim() || null,
    symbol: getPositionSymbol({ currency, instrument, kind, ticker })
  };
}

/**
 * Converts the ticker of a position to the format of Yahoo Finance, e.g.
 * DLR.U.TO (raw symbol DLR.U) to DLR-U.TO and BRK.B to BRK-B
 */
function getPositionSymbol({
  currency,
  instrument,
  kind,
  ticker
}: {
  currency: string;
  instrument: SnapTradePositionInput['instrument'];
  kind: string | null;
  ticker: string;
}) {
  if (kind === 'crypto') {
    const base = ticker.split(/[-/]/)[0].toUpperCase();

    return `${base}${currency}`;
  }

  const rawSymbol = instrument?.raw_symbol?.trim();

  if (!rawSymbol) {
    return ticker;
  }

  const suffix =
    ticker.toUpperCase().startsWith(`${rawSymbol.toUpperCase()}.`) &&
    ticker.length > rawSymbol.length + 1
      ? ticker.slice(rawSymbol.length + 1)
      : undefined;

  return (
    getYahooFinanceSymbol({
      exchange: suffix ? { suffix } : undefined,
      raw_symbol: rawSymbol,
      symbol: ticker
    } as never) ?? ticker
  );
}

function parseNumber(value?: string | null) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const result = Number(String(value).replace(/,/g, ''));

  return Number.isFinite(result) ? result : undefined;
}
