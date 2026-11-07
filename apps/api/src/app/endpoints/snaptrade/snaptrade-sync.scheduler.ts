import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { SnapTradeService } from './snaptrade.service';

@Injectable()
export class SnapTradeSyncScheduler {
  private isRunning = false;

  public constructor(
    private readonly configurationService: ConfigurationService,
    private readonly snapTradeService: SnapTradeService
  ) {}

  @Cron(CronExpression.EVERY_6_HOURS)
  public async syncEverySixHours() {
    if (!this.configurationService.get('ENABLE_FEATURE_CRON')) {
      return;
    }

    if (this.isRunning) {
      Logger.warn(
        'The previous SnapTrade sync is still running',
        SnapTradeSyncScheduler.name
      );

      return;
    }

    this.isRunning = true;

    try {
      await this.snapTradeService.syncAllUsers();
    } finally {
      this.isRunning = false;
    }
  }
}
