import { DataSource } from '@prisma/client';

import { mapSnapTradePosition } from './snaptrade-position.mapper';

describe('mapSnapTradePosition', () => {
  const dataSource = DataSource.YAHOO;

  it('maps a position of the Toronto Stock Exchange', () => {
    expect(
      mapSnapTradePosition({
        dataSource,
        position: {
          cost_basis: '45.53',
          currency: 'CAD',
          instrument: {
            currency: 'CAD',
            description: 'iShares Core Equity ETF Portfolio',
            exchange: 'XTSE',
            kind: 'etf',
            raw_symbol: 'XEQT',
            symbol: 'XEQT.TO'
          },
          price: '44.315',
          units: '49'
        }
      })
    ).toEqual({
      averagePrice: 45.53,
      currency: 'CAD',
      dataSource,
      kind: 'etf',
      name: 'iShares Core Equity ETF Portfolio',
      price: 44.315,
      quantity: 49,
      symbol: 'XEQT.TO'
    });
  });

  it('converts the share class to the format of Yahoo Finance', () => {
    expect(
      mapSnapTradePosition({
        dataSource,
        position: {
          currency: 'USD',
          instrument: {
            kind: 'etf',
            raw_symbol: 'DLR.U',
            symbol: 'DLR.U.TO'
          },
          price: '10.01',
          units: '100'
        }
      })
    ).toMatchObject({ averagePrice: null, symbol: 'DLR-U.TO' });

    expect(
      mapSnapTradePosition({
        dataSource,
        position: {
          currency: 'USD',
          instrument: { kind: 'stock', raw_symbol: 'BRK.B', symbol: 'BRK.B' },
          price: '480',
          units: '1'
        }
      })
    ).toMatchObject({ symbol: 'BRK-B' });
  });

  it('keeps the suffix of other exchanges', () => {
    expect(
      mapSnapTradePosition({
        dataSource,
        position: {
          currency: 'CAD',
          instrument: { kind: 'adr', raw_symbol: 'SAPG', symbol: 'SAPG.NE' },
          price: '8.02',
          units: '1.012'
        }
      })
    ).toMatchObject({ quantity: 1.012, symbol: 'SAPG.NE' });
  });

  it('skips cash equivalents, options and closed positions', () => {
    expect(
      mapSnapTradePosition({
        dataSource,
        position: {
          cash_equivalent: true,
          currency: 'CAD',
          instrument: { kind: 'etf', symbol: 'CASH.TO' },
          price: '50',
          units: '10'
        }
      })
    ).toEqual({ reason: 'Cash equivalent (covered by the cash balance)' });

    expect(
      mapSnapTradePosition({
        dataSource,
        position: {
          currency: 'USD',
          instrument: { kind: 'option', symbol: 'NVDA 261218C00200000' },
          price: '1.5',
          units: '1'
        }
      })
    ).toMatchObject({ reason: 'Instrument kind option is not supported' });

    expect(
      mapSnapTradePosition({
        dataSource,
        position: {
          currency: 'USD',
          instrument: { kind: 'stock', symbol: 'NVDA' },
          price: '186.64',
          units: '0'
        }
      })
    ).toMatchObject({ reason: 'No long position' });
  });
});
