import { DataSource } from '@prisma/client';

import {
  AlignmentHolding,
  calculateAlignment,
  getHoldingsFromActivities
} from './snaptrade-alignment.calculator';

describe('SnapTrade alignment', () => {
  const dataSource = DataSource.YAHOO;

  const holding = (
    symbol: string,
    quantity: number,
    averagePrice: number | null,
    marketPrice?: number
  ): AlignmentHolding => {
    return {
      averagePrice,
      dataSource,
      marketPrice,
      quantity,
      symbol,
      currency: 'CAD'
    };
  };

  /** Applies the activities of the corrections like Ghostfolio does */
  const apply = (
    ghostfolio: AlignmentHolding[],
    broker: AlignmentHolding[]
  ) => {
    const corrections = calculateAlignment({ broker, ghostfolio });

    const activities = [
      ...ghostfolio.map(({ averagePrice, quantity, symbol }) => {
        return {
          dataSource,
          quantity,
          symbol,
          currency: 'CAD',
          type: 'BUY',
          unitPrice: averagePrice ?? 0
        };
      }),
      ...corrections.flatMap(({ activities: correctionActivities, symbol }) => {
        return correctionActivities.map(({ quantity, type, unitPrice }) => {
          return {
            dataSource,
            quantity,
            symbol,
            type,
            unitPrice,
            currency: 'CAD'
          };
        });
      })
    ];

    return { corrections, holdings: getHoldingsFromActivities(activities) };
  };

  describe('getHoldingsFromActivities', () => {
    it('calculates the average cost like Ghostfolio', () => {
      expect(
        getHoldingsFromActivities([
          {
            currency: 'CAD',
            dataSource,
            quantity: 10,
            symbol: 'XEQT.TO',
            type: 'BUY',
            unitPrice: 30
          },
          {
            currency: 'CAD',
            dataSource,
            quantity: 10,
            symbol: 'XEQT.TO',
            type: 'BUY',
            unitPrice: 40
          },
          {
            currency: 'CAD',
            dataSource,
            quantity: 5,
            symbol: 'XEQT.TO',
            type: 'SELL',
            unitPrice: 50
          },
          {
            currency: 'CAD',
            dataSource,
            quantity: 1,
            symbol: 'XEQT.TO',
            type: 'DIVIDEND',
            unitPrice: 1
          }
        ])
      ).toEqual([
        {
          averagePrice: 35,
          currency: 'CAD',
          dataSource,
          name: null,
          quantity: 15,
          symbol: 'XEQT.TO'
        }
      ]);
    });
  });

  describe('calculateAlignment', () => {
    it('changes nothing if the holdings match', () => {
      expect(
        calculateAlignment({
          broker: [holding('XEQT.TO', 49, 45.53)],
          ghostfolio: [holding('XEQT.TO', 49, 45.531)]
        })
      ).toEqual([]);
    });

    it('buys the missing units at the price which gives the cost of the brokerage', () => {
      const { corrections, holdings } = apply(
        [holding('XEQT.TO', 40, 44)],
        [holding('XEQT.TO', 49, 45.53)]
      );

      expect(corrections).toHaveLength(1);
      expect(corrections[0].activities).toEqual([
        { quantity: 9, type: 'BUY', unitPrice: expect.closeTo(52.33, 2) }
      ]);
      expect(holdings[0].quantity).toBe(49);
      expect(holdings[0].averagePrice).toBeCloseTo(45.53, 6);
    });

    it('resets the cost if only the cost differs', () => {
      const { corrections, holdings } = apply(
        [holding('NFLX', 3, 80)],
        [holding('NFLX', 3, 96.54)]
      );

      expect(corrections[0].activities).toEqual([
        { quantity: 3, type: 'SELL', unitPrice: 80 },
        { quantity: 3, type: 'BUY', unitPrice: 96.54 }
      ]);
      expect(corrections[0].before).toEqual({ averagePrice: 80, quantity: 3 });
      expect(corrections[0].after).toEqual({
        averagePrice: 96.54,
        quantity: 3
      });
      expect(holdings[0]).toMatchObject({ averagePrice: 96.54, quantity: 3 });
    });

    it('sells the extra units at the average cost', () => {
      const { corrections, holdings } = apply(
        [holding('VFV.TO', 20, 140)],
        [holding('VFV.TO', 15, 140)]
      );

      expect(corrections[0].activities).toEqual([
        { quantity: 5, type: 'SELL', unitPrice: 140 }
      ]);
      expect(holdings[0]).toMatchObject({ averagePrice: 140, quantity: 15 });
    });

    it('resets the cost if fewer units cost differently', () => {
      const { corrections, holdings } = apply(
        [holding('VFV.TO', 20, 140)],
        [holding('VFV.TO', 15, 150)]
      );

      expect(corrections[0].activities).toEqual([
        { quantity: 20, type: 'SELL', unitPrice: 140 },
        { quantity: 15, type: 'BUY', unitPrice: 150 }
      ]);
      expect(holdings[0]).toMatchObject({ averagePrice: 150, quantity: 15 });
    });

    it('resets the cost if the missing units would need a negative price', () => {
      const { corrections, holdings } = apply(
        [holding('GOOG.TO', 20, 60)],
        [holding('GOOG.TO', 25, 45)]
      );

      expect(corrections[0].activities).toEqual([
        { quantity: 20, type: 'SELL', unitPrice: 60 },
        { quantity: 25, type: 'BUY', unitPrice: 45 }
      ]);
      expect(holdings[0]).toMatchObject({ averagePrice: 45, quantity: 25 });
    });

    it('buys a holding which is missing in Ghostfolio', () => {
      expect(
        calculateAlignment({
          broker: [holding('SHOP', 8, 157.99, 148.91)],
          ghostfolio: []
        })
      ).toEqual([
        {
          activities: [{ quantity: 8, type: 'BUY', unitPrice: 157.99 }],
          after: { averagePrice: 157.99, quantity: 8 },
          before: { averagePrice: null, quantity: 0 },
          currency: 'CAD',
          dataSource,
          name: null,
          symbol: 'SHOP'
        }
      ]);
    });

    it('buys at the market price without the cost of the brokerage', () => {
      expect(
        calculateAlignment({
          broker: [holding('SHOP', 8, null, 148.91)],
          ghostfolio: []
        })[0].activities
      ).toEqual([{ quantity: 8, type: 'BUY', unitPrice: 148.91 }]);
    });

    it('keeps the cost of Ghostfolio without the cost of the brokerage', () => {
      expect(
        calculateAlignment({
          broker: [holding('XIC.TO', 150, null, 57)],
          ghostfolio: [holding('XIC.TO', 146.3796, 51.3)]
        })[0].activities
      ).toEqual([
        { quantity: expect.closeTo(3.6204, 6), type: 'BUY', unitPrice: 51.3 }
      ]);
    });

    it('sells a holding which the brokerage does not report', () => {
      expect(
        calculateAlignment({
          broker: [],
          ghostfolio: [holding('BTCI', 113, 43.65)]
        })
      ).toEqual([
        expect.objectContaining({
          activities: [{ quantity: 113, type: 'SELL', unitPrice: 43.65 }],
          after: { averagePrice: null, quantity: 0 },
          symbol: 'BTCI'
        })
      ]);
    });
  });
});
