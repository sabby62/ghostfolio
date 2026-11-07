import {
  RebalancingDrift,
  RebalancingDriftPosition,
  RebalancingHoldingInput,
  RebalancingMode,
  RebalancingPlan,
  RebalancingTargetInput,
  RebalancingTrade
} from './interfaces/rebalancing.interface';

const EPSILON = 1e-9;
const MAX_GREEDY_ITERATIONS = 100_000;
const QUANTITY_DECIMALS = 6;
const VALUE_DECIMALS = 2;

interface PositionState {
  currency?: string;
  dataSource: string;
  investmentInBaseCurrency: number;
  isTargeted: boolean;
  name?: string;
  priceInBaseCurrency?: number;
  quantity: number;
  symbol: string;
  targetInPercentage: number;
  valueInBaseCurrency: number;
}

/**
 * Pure calculator for target allocations, drift and rebalancing trades. All
 * monetary values are in the base currency of the user and all percentages
 * are fractions (0.25 = 25%), like elsewhere in Ghostfolio.
 */
export class RebalancingCalculator {
  public static calculateDrift({
    cashInBaseCurrency,
    driftThresholdInPercentage,
    holdings,
    targets
  }: {
    cashInBaseCurrency: number;
    driftThresholdInPercentage: number;
    holdings: RebalancingHoldingInput[];
    targets: RebalancingTargetInput[];
  }): RebalancingDrift {
    RebalancingCalculator.validateTargets(targets);

    const positions = RebalancingCalculator.getPositionStates({
      holdings,
      targets
    });

    return RebalancingCalculator.getDrift({
      cashInBaseCurrency,
      driftThresholdInPercentage,
      positions
    });
  }

  public static calculatePlan({
    allowFractionalShares = false,
    cashInBaseCurrency,
    driftThresholdInPercentage,
    holdings,
    mode,
    newCashInBaseCurrency = 0,
    targets
  }: {
    allowFractionalShares?: boolean;
    cashInBaseCurrency: number;
    driftThresholdInPercentage: number;
    holdings: RebalancingHoldingInput[];
    mode: RebalancingMode;
    newCashInBaseCurrency?: number;
    targets: RebalancingTargetInput[];
  }): RebalancingPlan {
    RebalancingCalculator.validateTargets(targets);

    if (newCashInBaseCurrency < 0) {
      throw new Error('The new cash must not be negative');
    }

    const positions = RebalancingCalculator.getPositionStates({
      holdings,
      targets
    });

    const before = RebalancingCalculator.getDrift({
      cashInBaseCurrency: cashInBaseCurrency + newCashInBaseCurrency,
      driftThresholdInPercentage,
      positions
    });

    const totalValueInBaseCurrency = before.totalValueInBaseCurrency;
    const cashTargetInPercentage = before.cash.targetInPercentage;
    const warnings: string[] = [];
    const quantityChanges = new Map<PositionState, number>();

    let cash = cashInBaseCurrency + newCashInBaseCurrency;

    for (const position of positions) {
      if (
        position.priceInBaseCurrency === undefined ||
        position.priceInBaseCurrency <= 0
      ) {
        warnings.push(
          `No price available for ${position.symbol}, hence it is not traded`
        );
      }
    }

    // Sell the overweight positions first (full rebalance only)
    if (mode === 'FULL') {
      for (const position of positions) {
        const price = position.priceInBaseCurrency;

        if (!price || price <= 0) {
          continue;
        }

        const targetValue =
          totalValueInBaseCurrency * position.targetInPercentage;
        const excessValue = position.valueInBaseCurrency - targetValue;

        if (excessValue <= EPSILON) {
          continue;
        }

        let quantityToSell = allowFractionalShares
          ? excessValue / price
          : Math.floor(excessValue / price + EPSILON);

        if (!position.isTargeted) {
          // A holding without target is sold completely
          quantityToSell = position.quantity;
        }

        quantityToSell = Math.min(quantityToSell, position.quantity);

        if (quantityToSell <= EPSILON) {
          continue;
        }

        RebalancingCalculator.applyTrade({
          position,
          quantityChanges,
          quantity: -quantityToSell
        });

        cash += quantityToSell * price;
      }
    }

    // Buy the underweight positions with the cash above the cash target
    const cashReserve = totalValueInBaseCurrency * cashTargetInPercentage;
    let spendableCash = Math.max(0, cash - cashReserve);

    const buyablePositions = positions.filter(
      ({ isTargeted, priceInBaseCurrency }) => {
        return isTargeted && priceInBaseCurrency > 0;
      }
    );

    const deficits = buyablePositions.map((position) => {
      return Math.max(
        0,
        totalValueInBaseCurrency * position.targetInPercentage -
          position.valueInBaseCurrency
      );
    });

    const amounts = RebalancingCalculator.waterFill({
      budget: spendableCash,
      deficits
    });

    buyablePositions.forEach((position, index) => {
      const amount = amounts[index];

      if (amount <= EPSILON) {
        return;
      }

      const quantity = allowFractionalShares
        ? amount / position.priceInBaseCurrency
        : Math.floor(amount / position.priceInBaseCurrency + EPSILON);

      if (quantity <= EPSILON) {
        return;
      }

      RebalancingCalculator.applyTrade({ position, quantity, quantityChanges });

      const cost = quantity * position.priceInBaseCurrency;
      cash -= cost;
      spendableCash -= cost;
    });

    if (!allowFractionalShares) {
      // Spend the rest on whole shares of the most underweight positions
      for (let i = 0; i < MAX_GREEDY_ITERATIONS; i++) {
        let bestPosition: PositionState;
        let bestDeficit = 0;

        for (const position of buyablePositions) {
          const deficit =
            totalValueInBaseCurrency * position.targetInPercentage -
            position.valueInBaseCurrency;

          // Only buy a share if it reduces the absolute drift
          if (
            position.priceInBaseCurrency <= spendableCash + EPSILON &&
            deficit > position.priceInBaseCurrency / 2 &&
            deficit > bestDeficit
          ) {
            bestDeficit = deficit;
            bestPosition = position;
          }
        }

        if (!bestPosition) {
          break;
        }

        RebalancingCalculator.applyTrade({
          quantityChanges,
          position: bestPosition,
          quantity: 1
        });

        cash -= bestPosition.priceInBaseCurrency;
        spendableCash -= bestPosition.priceInBaseCurrency;
      }
    }

    const trades: RebalancingTrade[] = [];

    for (const [position, quantity] of quantityChanges) {
      const roundedQuantity = RebalancingCalculator.round(
        Math.abs(quantity),
        QUANTITY_DECIMALS
      );

      if (roundedQuantity <= 0) {
        continue;
      }

      trades.push({
        action: quantity > 0 ? 'BUY' : 'SELL',
        currency: position.currency,
        dataSource: position.dataSource,
        name: position.name,
        priceInBaseCurrency: RebalancingCalculator.round(
          position.priceInBaseCurrency,
          4
        ),
        quantity: roundedQuantity,
        symbol: position.symbol,
        valueInBaseCurrency: RebalancingCalculator.round(
          roundedQuantity * position.priceInBaseCurrency,
          VALUE_DECIMALS
        )
      });
    }

    // Sells first, then the largest buys
    trades.sort((a, b) => {
      if (a.action !== b.action) {
        return a.action === 'SELL' ? -1 : 1;
      }

      return b.valueInBaseCurrency - a.valueInBaseCurrency;
    });

    const after = RebalancingCalculator.getDrift({
      cashInBaseCurrency: cash,
      driftThresholdInPercentage,
      positions
    });

    return {
      after,
      before,
      mode,
      trades,
      warnings,
      allowFractionalShares,
      cashAfterInBaseCurrency: RebalancingCalculator.round(
        cash,
        VALUE_DECIMALS
      ),
      newCashInBaseCurrency
    };
  }

  /**
   * Distributes the budget so that the largest remaining deficit is as small
   * as possible (water filling). Gives the amount per deficit.
   */
  public static waterFill({
    budget,
    deficits
  }: {
    budget: number;
    deficits: number[];
  }) {
    const totalDeficit = deficits.reduce((sum, deficit) => {
      return sum + deficit;
    }, 0);

    if (budget <= EPSILON || totalDeficit <= EPSILON) {
      return deficits.map(() => {
        return 0;
      });
    }

    if (budget >= totalDeficit) {
      return [...deficits];
    }

    // Find the level L with sum(max(0, deficit - L)) = budget
    const sorted = [...deficits].sort((a, b) => {
      return b - a;
    });

    let level = 0;
    let runningSum = 0;

    for (let k = 0; k < sorted.length; k++) {
      runningSum += sorted[k];
      const candidateLevel = (runningSum - budget) / (k + 1);
      const next = sorted[k + 1] ?? 0;

      if (candidateLevel >= next) {
        level = candidateLevel;
        break;
      }
    }

    return deficits.map((deficit) => {
      return Math.max(0, deficit - level);
    });
  }

  private static applyTrade({
    position,
    quantity,
    quantityChanges
  }: {
    position: PositionState;
    quantity: number;
    quantityChanges: Map<PositionState, number>;
  }) {
    if (quantity > 0) {
      position.investmentInBaseCurrency +=
        quantity * position.priceInBaseCurrency;
    } else if (position.quantity > 0) {
      // A sell reduces the cost in proportion to the quantity
      position.investmentInBaseCurrency *=
        1 - Math.min(1, -quantity / position.quantity);
    }

    position.quantity += quantity;
    position.valueInBaseCurrency += quantity * position.priceInBaseCurrency;

    quantityChanges.set(
      position,
      (quantityChanges.get(position) ?? 0) + quantity
    );
  }

  private static getDrift({
    cashInBaseCurrency,
    driftThresholdInPercentage,
    positions
  }: {
    cashInBaseCurrency: number;
    driftThresholdInPercentage: number;
    positions: PositionState[];
  }): RebalancingDrift {
    const totalValueInBaseCurrency =
      cashInBaseCurrency +
      positions.reduce((sum, { valueInBaseCurrency }) => {
        return sum + valueInBaseCurrency;
      }, 0);

    const targetSum = positions.reduce((sum, { targetInPercentage }) => {
      return sum + targetInPercentage;
    }, 0);

    const getPercentage = (value: number) => {
      return totalValueInBaseCurrency > EPSILON
        ? value / totalValueInBaseCurrency
        : 0;
    };

    const driftPositions: RebalancingDriftPosition[] = positions
      .map((position) => {
        const currentInPercentage = getPercentage(position.valueInBaseCurrency);
        const driftInPercentage =
          currentInPercentage - position.targetInPercentage;

        return {
          currency: position.currency,
          dataSource: position.dataSource,
          driftInPercentage: RebalancingCalculator.round(driftInPercentage, 6),
          exceedsThreshold:
            Math.abs(driftInPercentage) > driftThresholdInPercentage + EPSILON,
          gainInBaseCurrency: RebalancingCalculator.round(
            position.valueInBaseCurrency - position.investmentInBaseCurrency,
            VALUE_DECIMALS
          ),
          investmentInBaseCurrency: RebalancingCalculator.round(
            position.investmentInBaseCurrency,
            VALUE_DECIMALS
          ),
          isTargeted: position.isTargeted,
          name: position.name,
          currentInPercentage: RebalancingCalculator.round(
            currentInPercentage,
            6
          ),
          quantity: RebalancingCalculator.round(
            position.quantity,
            QUANTITY_DECIMALS
          ),
          symbol: position.symbol,
          targetInPercentage: position.targetInPercentage,
          valueInBaseCurrency: RebalancingCalculator.round(
            position.valueInBaseCurrency,
            VALUE_DECIMALS
          )
        };
      })
      .sort((a, b) => {
        return Math.abs(b.driftInPercentage) - Math.abs(a.driftInPercentage);
      });

    const cashTargetInPercentage = Math.max(0, 1 - targetSum);
    const cashCurrentInPercentage = getPercentage(cashInBaseCurrency);

    const maxAbsoluteDriftInPercentage = driftPositions.reduce(
      (max, { driftInPercentage }) => {
        return Math.max(max, Math.abs(driftInPercentage));
      },
      0
    );

    return {
      driftThresholdInPercentage,
      maxAbsoluteDriftInPercentage,
      cash: {
        currentInPercentage: RebalancingCalculator.round(
          cashCurrentInPercentage,
          6
        ),
        driftInPercentage: RebalancingCalculator.round(
          cashCurrentInPercentage - cashTargetInPercentage,
          6
        ),
        targetInPercentage: RebalancingCalculator.round(
          cashTargetInPercentage,
          6
        ),
        valueInBaseCurrency: RebalancingCalculator.round(
          cashInBaseCurrency,
          VALUE_DECIMALS
        )
      },
      needsRebalancing: driftPositions.some(({ exceedsThreshold }) => {
        return exceedsThreshold;
      }),
      positions: driftPositions,
      totalValueInBaseCurrency: RebalancingCalculator.round(
        totalValueInBaseCurrency,
        VALUE_DECIMALS
      )
    };
  }

  private static getKey({
    dataSource,
    symbol
  }: {
    dataSource: string;
    symbol: string;
  }) {
    return `${dataSource}-${symbol}`;
  }

  private static getPositionStates({
    holdings,
    targets
  }: {
    holdings: RebalancingHoldingInput[];
    targets: RebalancingTargetInput[];
  }) {
    const positions = new Map<string, PositionState>();

    for (const holding of holdings) {
      if (holding.quantity <= 0) {
        continue;
      }

      const key = RebalancingCalculator.getKey(holding);
      const existing = positions.get(key);

      if (existing) {
        // The same holding in several accounts
        existing.investmentInBaseCurrency +=
          holding.investmentInBaseCurrency ?? holding.valueInBaseCurrency;
        existing.quantity += holding.quantity;
        existing.valueInBaseCurrency += holding.valueInBaseCurrency;
        existing.priceInBaseCurrency =
          existing.valueInBaseCurrency / existing.quantity;
      } else {
        positions.set(key, {
          currency: holding.currency,
          dataSource: holding.dataSource,
          // Without cost, the value is the cost, hence no gain
          investmentInBaseCurrency:
            holding.investmentInBaseCurrency ?? holding.valueInBaseCurrency,
          isTargeted: false,
          name: holding.name,
          priceInBaseCurrency:
            holding.priceInBaseCurrency ??
            holding.valueInBaseCurrency / holding.quantity,
          quantity: holding.quantity,
          symbol: holding.symbol,
          targetInPercentage: 0,
          valueInBaseCurrency: holding.valueInBaseCurrency
        });
      }
    }

    for (const target of targets) {
      const key = RebalancingCalculator.getKey(target);
      const existing = positions.get(key);

      if (existing) {
        existing.isTargeted = true;
        existing.targetInPercentage = target.targetInPercentage;
        existing.name = existing.name ?? target.name;
      } else {
        positions.set(key, {
          currency: target.currency,
          dataSource: target.dataSource,
          investmentInBaseCurrency: 0,
          isTargeted: true,
          name: target.name,
          priceInBaseCurrency: target.priceInBaseCurrency,
          quantity: 0,
          symbol: target.symbol,
          targetInPercentage: target.targetInPercentage,
          valueInBaseCurrency: 0
        });
      }
    }

    return [...positions.values()];
  }

  private static round(value: number, decimals: number) {
    const factor = 10 ** decimals;

    return Math.round(value * factor) / factor;
  }

  private static validateTargets(targets: RebalancingTargetInput[]) {
    const keys = new Set<string>();
    let sum = 0;

    for (const target of targets) {
      if (target.targetInPercentage < 0 || target.targetInPercentage > 1) {
        throw new Error(
          `The target of ${target.symbol} must be between 0 and 1`
        );
      }

      const key = RebalancingCalculator.getKey(target);

      if (keys.has(key)) {
        throw new Error(`The target of ${target.symbol} is given twice`);
      }

      keys.add(key);
      sum += target.targetInPercentage;
    }

    if (sum > 1 + 1e-6) {
      throw new Error('The sum of the targets must not exceed 1 (100%)');
    }
  }
}
