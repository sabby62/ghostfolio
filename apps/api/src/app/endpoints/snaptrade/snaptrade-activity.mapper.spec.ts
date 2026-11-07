import { DataSource } from '@prisma/client';

import {
  SnapTradeActivity,
  mapSnapTradeActivity
} from './snaptrade-activity.mapper';

describe('mapSnapTradeActivity', () => {
  const accountId = 'account-id';
  const dataSource = DataSource.YAHOO;

  const map = (activity: SnapTradeActivity) => {
    return mapSnapTradeActivity({ accountId, activity, dataSource });
  };

  const xeqt = {
    currency: { code: 'CAD' },
    symbol: 'XEQT.TO',
    type: { code: 'et' }
  };

  it('maps a buy with the ticker of the symbol', () => {
    expect(
      map({
        amount: -3510,
        currency: { code: 'CAD' },
        description: 'ISHARES CORE EQUITY ETF',
        fee: 9.95,
        id: 'activity-1',
        price: 35,
        symbol: xeqt,
        trade_date: '2026-03-02T00:00:00Z',
        type: 'BUY',
        units: 100
      })
    ).toEqual({
      activity: {
        accountId,
        dataSource,
        comment: 'SnapTrade: ISHARES CORE EQUITY ETF',
        currency: 'CAD',
        date: '2026-03-02T00:00:00.000Z',
        fee: 9.95,
        quantity: 100,
        symbol: 'XEQT.TO',
        type: 'BUY',
        unitPrice: 35
      },
      activityId: 'activity-1'
    });
  });

  it('maps a sell with negative units to a positive quantity', () => {
    const result = map({
      amount: 1740,
      currency: { code: 'CAD' },
      fee: 0,
      id: 'activity-2',
      price: 34.8,
      symbol: xeqt,
      trade_date: '2026-04-01',
      type: 'SELL',
      units: -50
    });

    expect(result).toMatchObject({
      activity: { quantity: 50, type: 'SELL', unitPrice: 34.8 }
    });
  });

  it('derives the unit price from the amount and the fee', () => {
    expect(
      map({
        amount: -1010,
        currency: { code: 'USD' },
        fee: 10,
        id: 'activity-3',
        symbol: { symbol: 'VTI' },
        trade_date: '2026-04-01',
        type: 'BUY',
        units: 4
      })
    ).toMatchObject({ activity: { currency: 'USD', unitPrice: 250 } });

    expect(
      map({
        amount: 990,
        currency: { code: 'USD' },
        fee: 10,
        id: 'activity-4',
        symbol: { symbol: 'VTI' },
        trade_date: '2026-04-01',
        type: 'SELL',
        units: -4
      })
    ).toMatchObject({ activity: { unitPrice: 250 } });
  });

  it('maps a reinvested dividend to a buy', () => {
    expect(
      map({
        amount: -70,
        currency: { code: 'CAD' },
        id: 'activity-5',
        price: 35,
        symbol: xeqt,
        trade_date: '2026-04-01',
        type: 'REI',
        units: 2
      })
    ).toMatchObject({ activity: { quantity: 2, type: 'BUY' } });
  });

  it('maps a dividend to its amount', () => {
    expect(
      map({
        amount: 42.5,
        currency: { code: 'CAD' },
        id: 'activity-6',
        price: 0,
        symbol: xeqt,
        trade_date: '2026-03-31',
        type: 'DIVIDEND',
        units: 0
      })
    ).toMatchObject({
      activity: {
        quantity: 1,
        symbol: 'XEQT.TO',
        type: 'DIVIDEND',
        unitPrice: 42.5
      }
    });
  });

  it('maps interest, fees and taxes without data source', () => {
    const interest = map({
      amount: 3.21,
      currency: { code: 'CAD' },
      id: 'activity-7',
      trade_date: '2026-03-31',
      type: 'INTEREST'
    });

    expect(interest).toMatchObject({
      activity: { symbol: 'Interest', type: 'INTEREST', unitPrice: 3.21 }
    });
    expect('activity' in interest && interest.activity.dataSource).toBe(
      undefined
    );

    expect(
      map({
        amount: -25,
        currency: { code: 'CAD' },
        id: 'activity-8',
        trade_date: '2026-03-31',
        type: 'TAX'
      })
    ).toMatchObject({
      activity: { symbol: 'Tax', type: 'FEE', unitPrice: 25 }
    });
  });

  it('skips the cash movements', () => {
    for (const type of ['CONTRIBUTION', 'WITHDRAWAL', 'TRANSFER']) {
      expect(
        map({
          type,
          amount: 1000,
          currency: { code: 'CAD' },
          id: 'activity-9',
          trade_date: '2026-03-31'
        })
      ).toEqual({
        activityId: 'activity-9',
        reason: 'Cash movement (covered by the cash balance)'
      });
    }
  });

  it('skips options, crypto, unknown types and incomplete activities', () => {
    expect(
      map({
        currency: { code: 'USD' },
        id: 'a',
        option_symbol: { ticker: 'AAPL 260116C00200000' },
        trade_date: '2026-03-31',
        type: 'BUY',
        units: 1
      })
    ).toMatchObject({ reason: 'Options are not supported' });

    expect(
      map({
        currency: { code: 'USD' },
        id: 'b',
        price: 60000,
        symbol: { symbol: 'BTC', type: { code: 'crypto' } },
        trade_date: '2026-03-31',
        type: 'BUY',
        units: 1
      })
    ).toMatchObject({ reason: 'Security type crypto is not supported' });

    expect(
      map({
        currency: { code: 'USD' },
        id: 'c',
        trade_date: '2026-03-31',
        type: 'SPLIT'
      })
    ).toMatchObject({ reason: 'Type SPLIT is not supported' });

    expect(
      map({ id: 'd', currency: { code: 'USD' }, type: 'BUY' })
    ).toMatchObject({ reason: 'Missing date' });

    expect(
      map({
        currency: { code: 'USD' },
        id: 'e',
        price: 10,
        trade_date: '2026-03-31',
        type: 'BUY',
        units: 1
      })
    ).toMatchObject({ reason: 'Missing symbol' });

    expect(
      map({ currency: { code: 'USD' }, trade_date: '2026-03-31', type: 'BUY' })
    ).toMatchObject({ reason: 'Missing identifier' });
  });
});
