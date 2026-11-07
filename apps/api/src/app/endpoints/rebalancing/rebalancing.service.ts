import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';
import { CallerFacingError } from '@ghostfolio/api/errors/caller-facing.error';
import {
  transformDataSourceInRequest,
  transformDataSourceInResponse
} from '@ghostfolio/api/helper/data-source.helper';
import { ApiService } from '@ghostfolio/api/services/api/api.service';
import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';
import { DataProviderService } from '@ghostfolio/api/services/data-provider/data-provider.service';
import { ExchangeRateDataService } from '@ghostfolio/api/services/exchange-rate-data/exchange-rate-data.service';
import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';
import { UserService } from '@ghostfolio/api/services/user/user.service';
import { DEFAULT_CURRENCY } from '@ghostfolio/common/config';
import {
  CalculateRebalancingDto,
  CreateRebalancingGroupDto,
  RebalancingTargetDto,
  UpdateRebalancingGroupDto
} from '@ghostfolio/common/dtos';
import { getAssetProfileIdentifier } from '@ghostfolio/common/helper';

import { Injectable } from '@nestjs/common';
import {
  AssetSubClass,
  DataSource,
  Prisma,
  RebalancingGroup,
  RebalancingTarget
} from '@prisma/client';

import {
  RebalancingDrift,
  RebalancingGroupResponse,
  RebalancingHoldingInput,
  RebalancingPlan,
  RebalancingTargetInput
} from './interfaces/rebalancing.interface';
import { RebalancingCalculator } from './rebalancing.calculator';

export class RebalancingGroupNotFoundError extends CallerFacingError {
  public constructor() {
    super('The rebalancing group was not found');

    this.name = 'RebalancingGroupNotFoundError';
  }
}

type RebalancingGroupWithTargets = RebalancingGroup & {
  targets: RebalancingTarget[];
};

@Injectable()
export class RebalancingService {
  public constructor(
    private readonly apiService: ApiService,
    private readonly configurationService: ConfigurationService,
    private readonly dataProviderService: DataProviderService,
    private readonly exchangeRateDataService: ExchangeRateDataService,
    private readonly portfolioService: PortfolioService,
    private readonly prismaService: PrismaService,
    private readonly userService: UserService
  ) {}

  public async calculate({
    data,
    id,
    userId
  }: {
    data: CalculateRebalancingDto;
    id: string;
    userId: string;
  }): Promise<RebalancingPlan & { baseCurrency: string; group: string }> {
    const group = await this.getGroupWithTargets({ id, userId });
    const { baseCurrency, cashInBaseCurrency, holdings, targets } =
      await this.getCalculatorInput({ group, userId });

    const plan = this.runCalculator(() => {
      return RebalancingCalculator.calculatePlan({
        cashInBaseCurrency,
        holdings,
        targets,
        allowFractionalShares: data.allowFractionalShares ?? false,
        driftThresholdInPercentage: group.driftThresholdInPercentage,
        mode: data.mode ?? 'BUY_ONLY',
        newCashInBaseCurrency: data.newCashInBaseCurrency ?? 0
      });
    });

    return {
      ...plan,
      baseCurrency,
      after: this.transformDrift(plan.after),
      before: this.transformDrift(plan.before),
      group: group.name,
      trades: plan.trades.map((trade) => {
        return {
          ...trade,
          dataSource: this.toResponseDataSource(trade.dataSource)
        };
      })
    };
  }

  public async createGroup({
    data,
    userId
  }: {
    data: CreateRebalancingGroupDto;
    userId: string;
  }): Promise<RebalancingGroupResponse> {
    const accountIds = await this.validateAccountIds({
      userId,
      accountIds: data.accountIds ?? []
    });
    const targets = this.validateTargets(data.targets);

    const group = await this.prismaService.rebalancingGroup.create({
      data: {
        accountIds,
        driftThresholdInPercentage: data.driftThresholdInPercentage ?? 0.05,
        name: data.name,
        targets: { create: targets },
        user: { connect: { id: userId } }
      },
      include: { targets: true }
    });

    return this.toGroupResponse(group);
  }

  public async deleteGroup({ id, userId }: { id: string; userId: string }) {
    await this.getGroupWithTargets({ id, userId });

    await this.prismaService.rebalancingGroup.delete({ where: { id } });
  }

  public async getDrift({
    id,
    userId
  }: {
    id: string;
    userId: string;
  }): Promise<
    RebalancingDrift & { baseCurrency: string; group: string; id: string }
  > {
    const group = await this.getGroupWithTargets({ id, userId });

    return this.getDriftOfGroup({ group, userId });
  }

  public async getDriftOfAllGroups({ userId }: { userId: string }) {
    const groups = await this.prismaService.rebalancingGroup.findMany({
      include: { targets: true },
      orderBy: { name: 'asc' },
      where: { userId }
    });

    const drifts: (RebalancingDrift & {
      baseCurrency: string;
      group: string;
      id: string;
    })[] = [];

    for (const group of groups) {
      drifts.push(await this.getDriftOfGroup({ group, userId }));
    }

    return drifts;
  }

  public async getGroup({
    id,
    userId
  }: {
    id: string;
    userId: string;
  }): Promise<RebalancingGroupResponse> {
    return this.toGroupResponse(await this.getGroupWithTargets({ id, userId }));
  }

  public async getGroups({
    userId
  }: {
    userId: string;
  }): Promise<RebalancingGroupResponse[]> {
    const groups = await this.prismaService.rebalancingGroup.findMany({
      include: { targets: true },
      orderBy: { name: 'asc' },
      where: { userId }
    });

    return groups.map((group) => {
      return this.toGroupResponse(group);
    });
  }

  public async updateGroup({
    data,
    id,
    userId
  }: {
    data: UpdateRebalancingGroupDto;
    id: string;
    userId: string;
  }): Promise<RebalancingGroupResponse> {
    await this.getGroupWithTargets({ id, userId });

    const updateData: Prisma.RebalancingGroupUpdateInput = {};

    if (data.accountIds) {
      updateData.accountIds = await this.validateAccountIds({
        userId,
        accountIds: data.accountIds
      });
    }

    if (data.driftThresholdInPercentage !== undefined) {
      updateData.driftThresholdInPercentage = data.driftThresholdInPercentage;
    }

    if (data.name) {
      updateData.name = data.name;
    }

    const targets = data.targets
      ? this.validateTargets(data.targets)
      : undefined;

    // Prisma runs a nested create before a nested deleteMany, which violates
    // the unique constraint for a target that is kept, hence the old targets
    // are deleted first in the same transaction
    const group = await this.prismaService.$transaction(async (prisma) => {
      if (targets) {
        await prisma.rebalancingTarget.deleteMany({ where: { groupId: id } });

        updateData.targets = { create: targets };
      }

      return prisma.rebalancingGroup.update({
        data: updateData,
        include: { targets: true },
        where: { id }
      });
    });

    return this.toGroupResponse(group);
  }

  private async getCalculatorInput({
    group,
    userId
  }: {
    group: RebalancingGroupWithTargets;
    userId: string;
  }) {
    const user = await this.userService.user({ id: userId });
    const baseCurrency =
      user?.settings?.settings?.baseCurrency ?? DEFAULT_CURRENCY;

    const filters =
      group.accountIds.length > 0
        ? this.apiService.buildFiltersFromQueryParams({
            filterByAccounts: group.accountIds
          })
        : undefined;

    const { holdings: portfolioHoldings } =
      await this.portfolioService.getDetails({
        filters,
        user,
        userId
      });

    let cashInBaseCurrency = 0;
    const holdings: RebalancingHoldingInput[] = [];

    for (const holding of portfolioHoldings) {
      const { assetProfile, quantity, valueInBaseCurrency } = holding;

      if (assetProfile.assetSubClass === AssetSubClass.CASH) {
        cashInBaseCurrency += valueInBaseCurrency ?? 0;
        continue;
      }

      if (!quantity || quantity <= 0) {
        continue;
      }

      holdings.push({
        quantity,
        currency: assetProfile.currency,
        investmentInBaseCurrency:
          holding.investmentWithCurrencyEffect ?? holding.investment,
        dataSource: assetProfile.dataSource,
        name: assetProfile.name,
        symbol: assetProfile.symbol,
        valueInBaseCurrency: valueInBaseCurrency ?? 0
      });
    }

    const heldIdentifiers = new Set(
      holdings.map(({ dataSource, symbol }) => {
        return getAssetProfileIdentifier({
          symbol,
          dataSource: dataSource as DataSource
        });
      })
    );

    const missingTargets = group.targets.filter(({ dataSource, symbol }) => {
      return !heldIdentifiers.has(
        getAssetProfileIdentifier({ dataSource, symbol })
      );
    });

    const quotes =
      missingTargets.length > 0
        ? await this.dataProviderService.getQuotes({
            items: missingTargets.map(({ dataSource, symbol }) => {
              return { dataSource, symbol };
            })
          })
        : {};

    const targets: RebalancingTargetInput[] = group.targets.map(
      ({ dataSource, symbol, targetInPercentage }) => {
        const quote = quotes[getAssetProfileIdentifier({ dataSource, symbol })];

        let priceInBaseCurrency: number;

        if (quote?.marketPrice > 0 && quote.currency) {
          priceInBaseCurrency = this.exchangeRateDataService.toCurrency(
            quote.marketPrice,
            quote.currency,
            baseCurrency
          );
        }

        return {
          dataSource,
          priceInBaseCurrency,
          symbol,
          targetInPercentage,
          currency: quote?.currency
        };
      }
    );

    return { baseCurrency, cashInBaseCurrency, holdings, targets };
  }

  private async getDriftOfGroup({
    group,
    userId
  }: {
    group: RebalancingGroupWithTargets;
    userId: string;
  }) {
    const { baseCurrency, cashInBaseCurrency, holdings, targets } =
      await this.getCalculatorInput({ group, userId });

    const drift = this.runCalculator(() => {
      return RebalancingCalculator.calculateDrift({
        cashInBaseCurrency,
        holdings,
        targets,
        driftThresholdInPercentage: group.driftThresholdInPercentage
      });
    });

    return {
      ...this.transformDrift(drift),
      baseCurrency,
      group: group.name,
      id: group.id
    };
  }

  private async getGroupWithTargets({
    id,
    userId
  }: {
    id: string;
    userId: string;
  }): Promise<RebalancingGroupWithTargets> {
    const group = await this.prismaService.rebalancingGroup.findFirst({
      include: { targets: true },
      where: { id, userId }
    });

    if (!group) {
      throw new RebalancingGroupNotFoundError();
    }

    return group;
  }

  private runCalculator<T>(calculate: () => T) {
    try {
      return calculate();
    } catch (error) {
      // The messages of the calculator are written for the caller
      throw new CallerFacingError((error as Error).message);
    }
  }

  private toGroupResponse(
    group: RebalancingGroupWithTargets
  ): RebalancingGroupResponse {
    return {
      accountIds: group.accountIds,
      createdAt: group.createdAt,
      driftThresholdInPercentage: group.driftThresholdInPercentage,
      id: group.id,
      name: group.name,
      targets: group.targets
        .map(({ dataSource, symbol, targetInPercentage }) => {
          return {
            symbol,
            targetInPercentage,
            dataSource: this.toResponseDataSource(dataSource)
          };
        })
        .sort((a, b) => {
          return b.targetInPercentage - a.targetInPercentage;
        }),
      updatedAt: group.updatedAt
    };
  }

  private toResponseDataSource(dataSource: string) {
    return transformDataSourceInResponse({
      configurationService: this.configurationService,
      dataSource: dataSource as DataSource
    });
  }

  private transformDrift(drift: RebalancingDrift): RebalancingDrift {
    return {
      ...drift,
      positions: drift.positions.map((position) => {
        return {
          ...position,
          dataSource: this.toResponseDataSource(position.dataSource)
        };
      })
    };
  }

  private async validateAccountIds({
    accountIds,
    userId
  }: {
    accountIds: string[];
    userId: string;
  }) {
    const uniqueAccountIds = [...new Set(accountIds)];

    if (uniqueAccountIds.length === 0) {
      return [];
    }

    const accounts = await this.prismaService.account.findMany({
      select: { id: true },
      where: { userId, id: { in: uniqueAccountIds } }
    });

    if (accounts.length !== uniqueAccountIds.length) {
      throw new CallerFacingError(
        'At least one account of the group was not found'
      );
    }

    return uniqueAccountIds;
  }

  private validateTargets(targets: RebalancingTargetDto[]) {
    const transformedTargets = targets.map(
      ({ dataSource, symbol, targetInPercentage }) => {
        const transformedDataSource = transformDataSourceInRequest({
          dataSource,
          configurationService: this.configurationService
        });

        if (
          !transformedDataSource ||
          !Object.hasOwn(DataSource, transformedDataSource)
        ) {
          throw new CallerFacingError(
            `The data source of ${symbol} is not valid`
          );
        }

        return {
          symbol: symbol.trim(),
          dataSource: transformedDataSource,
          targetInPercentage
        };
      }
    );

    // Validates the sum and the duplicates
    this.runCalculator(() => {
      return RebalancingCalculator.calculateDrift({
        cashInBaseCurrency: 0,
        driftThresholdInPercentage: 0,
        holdings: [],
        targets: transformedTargets
      });
    });

    return transformedTargets;
  }
}
