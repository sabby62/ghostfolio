import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';

import { SnapTradeClientService } from './snaptrade-client.service';

describe('SnapTradeClientService', () => {
  let getAccountActivities: jest.Mock;
  let snapTradeClientService: SnapTradeClientService;

  beforeEach(() => {
    getAccountActivities = jest.fn().mockResolvedValue({
      data: { data: [{ id: 'activity-1' }], pagination: { total: 1 } }
    });

    snapTradeClientService = new SnapTradeClientService({
      get: jest.fn().mockImplementation((key: string) => {
        return {
          SNAPTRADE_AUTH_MODE: 'personal',
          SNAPTRADE_CLIENT_ID: 'client-id',
          SNAPTRADE_CONSUMER_KEY: 'consumer-key'
        }[key];
      })
    } as unknown as ConfigurationService);

    // Replaces the SDK client
    (snapTradeClientService as unknown as { client: unknown }).client = {
      accountInformation: { getAccountActivities }
    };
  });

  it('passes the start date as a date without time', async () => {
    await snapTradeClientService.getActivities({
      accountId: 'account-id',
      credentials: {},
      startDate: new Date('2026-01-06T00:00:00.000Z')
    });

    expect(getAccountActivities).toHaveBeenCalledWith({
      accountId: 'account-id',
      limit: 1000,
      offset: 0,
      startDate: '2026-01-06'
    });
  });

  it('passes no start date for the full history', async () => {
    const activities = await snapTradeClientService.getActivities({
      accountId: 'account-id',
      credentials: {}
    });

    expect(getAccountActivities).toHaveBeenCalledWith(
      expect.objectContaining({ startDate: undefined })
    );
    expect(activities).toEqual([{ id: 'activity-1' }]);
  });
});
