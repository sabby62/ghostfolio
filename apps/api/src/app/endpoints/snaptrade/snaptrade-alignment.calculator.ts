import { getAssetProfileIdentifier } from '@ghostfolio/common/helper';

import { DataSource } from '@prisma/client';

export interface AlignmentHolding {
  /** Average cost per unit in the currency of the asset, null if unknown */
  averagePrice: number | null;
  currency: string;
  dataSource: DataSource;
  /** Market price per unit in the currency of the asset */
  marketPrice?: number;
  name?: string | null;
  quantity: number;
  symbol: string;
}

export interface AlignmentActivityInput {
  currency: string;
  dataSource: DataSource;
  name?: string | null;
  quantity: number;
  symbol: string;
  type: string;
  /** Unit price in the currency of the asset */
  unitPrice: number;
}

export interface AlignmentActivity {
  quantity: number;
  type: 'BUY' | 'SELL';
  /** Unit price in the currency of the asset */
  unitPrice: number;
}

export interface AlignmentCorrection {
  /** The activities in this order, which turn before into after */
  activities: AlignmentActivity[];
  after: { averagePrice: number | null; quantity: number };
  before: { averagePrice: number | null; quantity: number };
  currency: string;
  dataSource: DataSource;
  name: string | null;
  symbol: string;
}

/** Quantities closer than this (relative) are considered equal */
const QUANTITY_TOLERANCE = 1e-6;

/** Average costs closer than this (relative) are considered equal */
const COST_TOLERANCE = 0.0005;

/** Average costs closer than this (absolute) are considered equal */
const COST_TOLERANCE_ABSOLUTE = 0.005;

/**
 * Calculates the quantity and the average cost of each holding from the
 * activities like Ghostfolio does: a buy adds its cost, a sell removes the
 * average cost of the units sold (average cost method)
 */
export function getHoldingsFromActivities(
  activities: AlignmentActivityInput[]
): AlignmentHolding[] {
  const holdings = new Map<string, AlignmentHolding & { investment: number }>();

  for (const activity of activities) {
    if (activity.type !== 'BUY' && activity.type !== 'SELL') {
      continue;
    }

    const identifier = getAssetProfileIdentifier(activity);

    const existingHolding = holdings.get(identifier);
    const { quantity, unitPrice } = activity;

    if (!existingHolding) {
      const factor = activity.type === 'BUY' ? 1 : -1;

      holdings.set(identifier, {
        averagePrice: unitPrice,
        currency: activity.currency,
        dataSource: activity.dataSource,
        investment: factor * quantity * unitPrice,
        name: activity.name ?? null,
        quantity: factor * quantity,
        symbol: activity.symbol
      });

      continue;
    }

    const holding = existingHolding;

    // Like the portfolio calculator of Ghostfolio
    if (activity.type === 'BUY') {
      holding.investment +=
        quantity *
        (holding.investment >= 0 ? unitPrice : (holding.averagePrice ?? 0));
      holding.quantity += quantity;
    } else {
      holding.investment -=
        quantity *
        (holding.investment > 0 ? (holding.averagePrice ?? 0) : unitPrice);
      holding.quantity -= quantity;
    }

    if (Math.abs(holding.quantity) < Number.EPSILON) {
      holding.investment = 0;
      holding.quantity = 0;
    }

    holding.averagePrice =
      holding.quantity === 0
        ? 0
        : Math.abs(holding.investment / holding.quantity);

    holdings.set(identifier, holding);
  }

  return [...holdings.values()].map(
    ({ averagePrice, currency, dataSource, name, quantity, symbol }) => {
      return { averagePrice, currency, dataSource, name, quantity, symbol };
    }
  );
}

/**
 * Calculates the activities which align the holdings of Ghostfolio with the
 * ones of the brokerage. The activities never realize a gain: units are sold
 * at the average cost of Ghostfolio. If only the cost differs, all units are
 * sold at the average cost of Ghostfolio and bought again at the average cost
 * of the brokerage.
 */
export function calculateAlignment({
  broker,
  ghostfolio
}: {
  /** The average price in the currency of the asset in Ghostfolio */
  broker: AlignmentHolding[];
  ghostfolio: AlignmentHolding[];
}): AlignmentCorrection[] {
  const brokerByIdentifier = new Map(
    broker.map((holding) => {
      return [getAssetProfileIdentifier(holding), holding];
    })
  );

  const ghostfolioByIdentifier = new Map(
    ghostfolio
      .filter(({ quantity }) => {
        return Math.abs(quantity) > QUANTITY_TOLERANCE;
      })
      .map((holding) => {
        return [getAssetProfileIdentifier(holding), holding];
      })
  );

  const identifiers = new Set([
    ...brokerByIdentifier.keys(),
    ...ghostfolioByIdentifier.keys()
  ]);

  const corrections: AlignmentCorrection[] = [];

  for (const identifier of identifiers) {
    const brokerHolding = brokerByIdentifier.get(identifier);
    const ghostfolioHolding = ghostfolioByIdentifier.get(identifier);
    const holding = ghostfolioHolding ?? brokerHolding;

    const brokerQuantity = brokerHolding?.quantity ?? 0;
    const brokerAveragePrice = brokerHolding?.averagePrice ?? null;
    const quantity = ghostfolioHolding?.quantity ?? 0;
    const averagePrice = ghostfolioHolding?.averagePrice ?? 0;

    const isQuantityEqual =
      Math.abs(brokerQuantity - quantity) <=
      QUANTITY_TOLERANCE * Math.max(1, Math.abs(brokerQuantity));

    const isCostEqual =
      brokerAveragePrice === null ||
      Math.abs(brokerAveragePrice - averagePrice) <=
        Math.max(COST_TOLERANCE_ABSOLUTE, COST_TOLERANCE * brokerAveragePrice);

    if (isQuantityEqual && (brokerQuantity === 0 || isCostEqual)) {
      continue;
    }

    const activities: AlignmentActivity[] = [];

    const resetCost = () => {
      if (quantity > 0) {
        activities.push({ quantity, type: 'SELL', unitPrice: averagePrice });
      } else if (quantity < 0) {
        activities.push({
          quantity: -quantity,
          type: 'BUY',
          unitPrice: averagePrice
        });
      }

      if (brokerQuantity > 0) {
        activities.push({
          quantity: brokerQuantity,
          type: 'BUY',
          unitPrice:
            brokerAveragePrice ?? brokerHolding?.marketPrice ?? averagePrice
        });
      }
    };

    if (quantity <= 0 || brokerQuantity <= 0) {
      resetCost();
    } else if (brokerQuantity > quantity) {
      const difference = brokerQuantity - quantity;

      if (brokerAveragePrice === null) {
        // Keeps the average cost of Ghostfolio
        activities.push({
          quantity: difference,
          type: 'BUY',
          unitPrice: averagePrice
        });
      } else {
        const unitPrice =
          (brokerQuantity * brokerAveragePrice - quantity * averagePrice) /
          difference;

        if (unitPrice >= 0) {
          activities.push({ unitPrice, quantity: difference, type: 'BUY' });
        } else {
          resetCost();
        }
      }
    } else if (brokerQuantity < quantity && isCostEqual) {
      // A sale at the average cost keeps the average cost
      activities.push({
        quantity: quantity - brokerQuantity,
        type: 'SELL',
        unitPrice: averagePrice
      });
    } else {
      resetCost();
    }

    corrections.push({
      activities: activities.filter((activity) => {
        return activity.quantity > 0;
      }),
      after: {
        averagePrice:
          brokerQuantity > 0 ? (brokerAveragePrice ?? averagePrice) : null,
        quantity: brokerQuantity
      },
      before: {
        quantity,
        averagePrice: ghostfolioHolding ? averagePrice : null
      },
      currency: holding.currency,
      dataSource: holding.dataSource,
      name: ghostfolioHolding?.name ?? brokerHolding?.name ?? null,
      symbol: holding.symbol
    });
  }

  return corrections.sort((a, b) => {
    return a.symbol.localeCompare(b.symbol);
  });
}
