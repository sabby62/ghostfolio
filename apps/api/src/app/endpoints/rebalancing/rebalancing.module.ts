import { PortfolioModule } from '@ghostfolio/api/app/portfolio/portfolio.module';
import { ApiModule } from '@ghostfolio/api/services/api/api.module';
import { ConfigurationModule } from '@ghostfolio/api/services/configuration/configuration.module';
import { DataProviderModule } from '@ghostfolio/api/services/data-provider/data-provider.module';
import { ExchangeRateDataModule } from '@ghostfolio/api/services/exchange-rate-data/exchange-rate-data.module';
import { ImpersonationModule } from '@ghostfolio/api/services/impersonation/impersonation.module';
import { PrismaModule } from '@ghostfolio/api/services/prisma/prisma.module';
import { UserModule } from '@ghostfolio/api/services/user/user.module';

import { Module } from '@nestjs/common';

import { RebalancingController } from './rebalancing.controller';
import { RebalancingService } from './rebalancing.service';

@Module({
  controllers: [RebalancingController],
  exports: [RebalancingService],
  imports: [
    ApiModule,
    ConfigurationModule,
    DataProviderModule,
    ExchangeRateDataModule,
    ImpersonationModule,
    PortfolioModule,
    PrismaModule,
    UserModule
  ],
  providers: [RebalancingService]
})
export class RebalancingModule {}
