import { RebalancingCalculator } from './rebalancing.calculator';

describe('RebalancingCalculator', () => {
  const xeqt = { dataSource: 'YAHOO', symbol: 'XEQT.TO' };
  const vfv = { dataSource: 'YAHOO', symbol: 'VFV.TO' };
  const zag = { dataSource: 'YAHOO', symbol: 'ZAG.TO' };
  const msft = { dataSource: 'YAHOO', symbol: 'MSFT' };

  describe('calculateDrift', () => {
    it('gives the drift of each position and of the cash', () => {
      const drift = RebalancingCalculator.calculateDrift({
        cashInBaseCurrency: 1000,
        driftThresholdInPercentage: 0.05,
        holdings: [
          { ...xeqt, quantity: 200, valueInBaseCurrency: 7000 },
          { ...vfv, quantity: 20, valueInBaseCurrency: 2000 }
        ],
        targets: [
          { ...xeqt, targetInPercentage: 0.6 },
          { ...vfv, targetInPercentage: 0.4 }
        ]
      });

      expect(drift.totalValueInBaseCurrency).toBe(10000);
      expect(drift.cash.targetInPercentage).toBe(0);
      expect(drift.cash.currentInPercentage).toBe(0.1);

      const xeqtDrift = drift.positions.find(({ symbol }) => {
        return symbol === xeqt.symbol;
      });
      const vfvDrift = drift.positions.find(({ symbol }) => {
        return symbol === vfv.symbol;
      });

      expect(xeqtDrift.driftInPercentage).toBeCloseTo(0.1);
      expect(xeqtDrift.exceedsThreshold).toBe(true);
      expect(vfvDrift.driftInPercentage).toBeCloseTo(-0.2);
      expect(drift.needsRebalancing).toBe(true);
      expect(drift.maxAbsoluteDriftInPercentage).toBeCloseTo(0.2);
    });

    it('treats a holding without target as a target of 0', () => {
      const drift = RebalancingCalculator.calculateDrift({
        cashInBaseCurrency: 0,
        driftThresholdInPercentage: 0.05,
        holdings: [
          { ...xeqt, quantity: 100, valueInBaseCurrency: 9000 },
          { ...msft, quantity: 2, valueInBaseCurrency: 1000 }
        ],
        targets: [{ ...xeqt, targetInPercentage: 1 }]
      });

      const msftDrift = drift.positions.find(({ symbol }) => {
        return symbol === msft.symbol;
      });

      expect(msftDrift.isTargeted).toBe(false);
      expect(msftDrift.targetInPercentage).toBe(0);
      expect(msftDrift.driftInPercentage).toBeCloseTo(0.1);
    });

    it('merges the same holding of several accounts', () => {
      const drift = RebalancingCalculator.calculateDrift({
        cashInBaseCurrency: 0,
        driftThresholdInPercentage: 0.05,
        holdings: [
          { ...xeqt, quantity: 10, valueInBaseCurrency: 350 },
          { ...xeqt, quantity: 20, valueInBaseCurrency: 700 }
        ],
        targets: [{ ...xeqt, targetInPercentage: 1 }]
      });

      expect(drift.positions).toHaveLength(1);
      expect(drift.positions[0].quantity).toBe(30);
      expect(drift.positions[0].valueInBaseCurrency).toBe(1050);
      expect(drift.needsRebalancing).toBe(false);
    });

    it('refuses targets above 100%', () => {
      expect(() => {
        RebalancingCalculator.calculateDrift({
          cashInBaseCurrency: 0,
          driftThresholdInPercentage: 0.05,
          holdings: [],
          targets: [
            { ...xeqt, targetInPercentage: 0.7 },
            { ...vfv, targetInPercentage: 0.4 }
          ]
        });
      }).toThrow('must not exceed 1');
    });

    it('refuses a duplicate target', () => {
      expect(() => {
        RebalancingCalculator.calculateDrift({
          cashInBaseCurrency: 0,
          driftThresholdInPercentage: 0.05,
          holdings: [],
          targets: [
            { ...xeqt, targetInPercentage: 0.5 },
            { ...xeqt, targetInPercentage: 0.5 }
          ]
        });
      }).toThrow('given twice');
    });
  });

  describe('calculatePlan', () => {
    it('invests new cash in whole shares without selling (buy only)', () => {
      const plan = RebalancingCalculator.calculatePlan({
        cashInBaseCurrency: 0,
        driftThresholdInPercentage: 0.05,
        holdings: [
          { ...xeqt, quantity: 200, valueInBaseCurrency: 7000 },
          { ...vfv, quantity: 30, valueInBaseCurrency: 3000 }
        ],
        mode: 'BUY_ONLY',
        newCashInBaseCurrency: 2000,
        targets: [
          { ...xeqt, targetInPercentage: 0.6 },
          { ...vfv, targetInPercentage: 0.4 }
        ]
      });

      // Total 12000: XEQT target 7200 (deficit 200), VFV target 4800 (deficit 1800)
      expect(
        plan.trades.every(({ action }) => {
          return action === 'BUY';
        })
      ).toBe(true);

      const xeqtTrade = plan.trades.find(({ symbol }) => {
        return symbol === xeqt.symbol;
      });
      const vfvTrade = plan.trades.find(({ symbol }) => {
        return symbol === vfv.symbol;
      });

      expect(vfvTrade.quantity).toBe(18);
      expect(xeqtTrade.quantity).toBe(5);
      expect(Number.isInteger(xeqtTrade.quantity)).toBe(true);
      expect(plan.cashAfterInBaseCurrency).toBe(25);
      expect(plan.cashAfterInBaseCurrency).toBeGreaterThanOrEqual(0);
    });

    it('never spends more cash than available', () => {
      const plan = RebalancingCalculator.calculatePlan({
        cashInBaseCurrency: 150,
        driftThresholdInPercentage: 0.05,
        holdings: [{ ...xeqt, quantity: 100, valueInBaseCurrency: 3500 }],
        mode: 'BUY_ONLY',
        targets: [
          { ...xeqt, targetInPercentage: 0.5 },
          { ...vfv, priceInBaseCurrency: 100, targetInPercentage: 0.5 }
        ]
      });

      const spent = plan.trades.reduce((sum, { valueInBaseCurrency }) => {
        return sum + valueInBaseCurrency;
      }, 0);

      expect(spent).toBeLessThanOrEqual(150);
      expect(plan.trades).toEqual([
        expect.objectContaining({
          action: 'BUY',
          quantity: 1,
          symbol: vfv.symbol
        })
      ]);
      expect(plan.cashAfterInBaseCurrency).toBe(50);
    });

    it('distributes limited cash to the most underweight targets first', () => {
      const amounts = RebalancingCalculator.waterFill({
        budget: 300,
        deficits: [500, 100, 0]
      });

      expect(amounts[0]).toBeCloseTo(300);
      expect(amounts[1]).toBeCloseTo(0);
      expect(amounts[2]).toBe(0);

      const balancedAmounts = RebalancingCalculator.waterFill({
        budget: 500,
        deficits: [500, 100, 0]
      });

      expect(balancedAmounts[0]).toBeCloseTo(450);
      expect(balancedAmounts[1]).toBeCloseTo(50);
    });

    it('sells overweight and untargeted holdings in a full rebalance', () => {
      const plan = RebalancingCalculator.calculatePlan({
        cashInBaseCurrency: 0,
        driftThresholdInPercentage: 0.05,
        holdings: [
          { ...xeqt, quantity: 200, valueInBaseCurrency: 8000 },
          { ...zag, quantity: 100, valueInBaseCurrency: 1000 },
          { ...msft, quantity: 2, valueInBaseCurrency: 1000 }
        ],
        mode: 'FULL',
        targets: [
          { ...xeqt, targetInPercentage: 0.6 },
          { ...zag, targetInPercentage: 0.4 }
        ]
      });

      // Total 10000: XEQT 8000 -> 6000, ZAG 1000 -> 4000, MSFT 1000 -> 0
      expect(plan.trades).toEqual([
        expect.objectContaining({
          action: 'SELL',
          quantity: 50,
          symbol: xeqt.symbol
        }),
        expect.objectContaining({
          action: 'SELL',
          quantity: 2,
          symbol: msft.symbol
        }),
        expect.objectContaining({
          action: 'BUY',
          quantity: 300,
          symbol: zag.symbol
        })
      ]);
      expect(plan.cashAfterInBaseCurrency).toBe(0);
      expect(plan.after.maxAbsoluteDriftInPercentage).toBeCloseTo(0);
      expect(plan.after.needsRebalancing).toBe(false);
    });

    it('keeps the cash target as a reserve', () => {
      const plan = RebalancingCalculator.calculatePlan({
        allowFractionalShares: true,
        cashInBaseCurrency: 1000,
        driftThresholdInPercentage: 0.05,
        holdings: [{ ...xeqt, quantity: 100, valueInBaseCurrency: 9000 }],
        mode: 'BUY_ONLY',
        targets: [
          { ...xeqt, targetInPercentage: 0.8 },
          { ...vfv, priceInBaseCurrency: 100, targetInPercentage: 0.15 }
        ]
      });

      // Total 10000, cash target 5% = 500, hence 500 to spend on VFV
      expect(plan.trades).toEqual([
        expect.objectContaining({
          action: 'BUY',
          quantity: 5,
          symbol: vfv.symbol
        })
      ]);
      expect(plan.cashAfterInBaseCurrency).toBe(500);
    });

    it('buys fractional shares if allowed', () => {
      const plan = RebalancingCalculator.calculatePlan({
        allowFractionalShares: true,
        cashInBaseCurrency: 0,
        driftThresholdInPercentage: 0.05,
        holdings: [],
        mode: 'BUY_ONLY',
        newCashInBaseCurrency: 1000,
        targets: [
          { ...xeqt, priceInBaseCurrency: 30, targetInPercentage: 0.5 },
          { ...vfv, priceInBaseCurrency: 70, targetInPercentage: 0.5 }
        ]
      });

      const xeqtTrade = plan.trades.find(({ symbol }) => {
        return symbol === xeqt.symbol;
      });

      expect(xeqtTrade.quantity).toBeCloseTo(16.666667, 5);
      expect(plan.cashAfterInBaseCurrency).toBeCloseTo(0);
    });

    it('warns about a target without price and does not trade it', () => {
      const plan = RebalancingCalculator.calculatePlan({
        cashInBaseCurrency: 1000,
        driftThresholdInPercentage: 0.05,
        holdings: [],
        mode: 'BUY_ONLY',
        targets: [{ ...vfv, targetInPercentage: 1 }]
      });

      expect(plan.trades).toEqual([]);
      expect(plan.warnings).toEqual([
        'No price available for VFV.TO, hence it is not traded'
      ]);
    });

    it('refuses negative new cash', () => {
      expect(() => {
        RebalancingCalculator.calculatePlan({
          cashInBaseCurrency: 0,
          driftThresholdInPercentage: 0.05,
          holdings: [],
          mode: 'BUY_ONLY',
          newCashInBaseCurrency: -1,
          targets: []
        });
      }).toThrow('must not be negative');
    });
  });
});
