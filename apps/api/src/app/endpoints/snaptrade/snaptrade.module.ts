import { AccountBalanceModule } from '@ghostfolio/api/services/account-balance/account-balance.module';
import { AccountModule } from '@ghostfolio/api/services/account/account.module';
import { ActivitiesModule } from '@ghostfolio/api/services/activities/activities.module';
import { ConfigurationModule } from '@ghostfolio/api/services/configuration/configuration.module';
import { DataProviderModule } from '@ghostfolio/api/services/data-provider/data-provider.module';
import { ExchangeRateDataModule } from '@ghostfolio/api/services/exchange-rate-data/exchange-rate-data.module';
import { ImpersonationModule } from '@ghostfolio/api/services/impersonation/impersonation.module';
import { ImportModule } from '@ghostfolio/api/services/import/import.module';
import { PrismaModule } from '@ghostfolio/api/services/prisma/prisma.module';
import { UserModule } from '@ghostfolio/api/services/user/user.module';

import { Module } from '@nestjs/common';

import { SnapTradeAlignmentService } from './snaptrade-alignment.service';
import { SnapTradeClientService } from './snaptrade-client.service';
import { SnapTradeHoldingsService } from './snaptrade-holdings.service';
import { SnapTradeSyncScheduler } from './snaptrade-sync.scheduler';
import { SnapTradeController } from './snaptrade.controller';
import { SnapTradeService } from './snaptrade.service';

@Module({
  controllers: [SnapTradeController],
  exports: [SnapTradeHoldingsService, SnapTradeService],
  imports: [
    AccountBalanceModule,
    AccountModule,
    ActivitiesModule,
    ConfigurationModule,
    DataProviderModule,
    ExchangeRateDataModule,
    ImpersonationModule,
    ImportModule,
    PrismaModule,
    UserModule
  ],
  providers: [
    SnapTradeAlignmentService,
    SnapTradeClientService,
    SnapTradeHoldingsService,
    SnapTradeService,
    SnapTradeSyncScheduler
  ]
})
export class SnapTradeModule {}
