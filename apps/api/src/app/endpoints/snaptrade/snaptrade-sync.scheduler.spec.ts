import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';

import { SnapTradeSyncScheduler } from './snaptrade-sync.scheduler';
import { SnapTradeService } from './snaptrade.service';

describe('SnapTradeSyncScheduler', () => {
  let isCronEnabled: boolean;
  let scheduler: SnapTradeSyncScheduler;
  let snapTradeService: SnapTradeService;

  beforeEach(() => {
    isCronEnabled = true;

    snapTradeService = {
      syncAllUsers: jest.fn().mockResolvedValue(undefined)
    } as unknown as SnapTradeService;

    scheduler = new SnapTradeSyncScheduler(
      {
        get: jest.fn().mockImplementation(() => {
          return isCronEnabled;
        })
      } as unknown as ConfigurationService,
      snapTradeService
    );
  });

  it('syncs all users', async () => {
    await scheduler.syncEverySixHours();

    expect(snapTradeService.syncAllUsers).toHaveBeenCalledTimes(1);
  });

  it('does not sync if the cron jobs are disabled', async () => {
    isCronEnabled = false;

    await scheduler.syncEverySixHours();

    expect(snapTradeService.syncAllUsers).not.toHaveBeenCalled();
  });

  it('does not start a sync while the previous one is running', async () => {
    let finish: () => void;

    jest.mocked(snapTradeService.syncAllUsers).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      })
    );

    const firstRun = scheduler.syncEverySixHours();
    await scheduler.syncEverySixHours();

    expect(snapTradeService.syncAllUsers).toHaveBeenCalledTimes(1);

    finish();
    await firstRun;

    await scheduler.syncEverySixHours();

    expect(snapTradeService.syncAllUsers).toHaveBeenCalledTimes(2);
  });
});
