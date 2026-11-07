import { HasPermission } from '@ghostfolio/api/decorators/has-permission.decorator';
import { Impersonation } from '@ghostfolio/api/decorators/impersonation.decorator';
import { RequiresScope } from '@ghostfolio/api/decorators/requires-scope.decorator';
import { CallerFacingError } from '@ghostfolio/api/errors/caller-facing.error';
import {
  CalculateRebalancingDto,
  CreateRebalancingGroupDto,
  UpdateRebalancingGroupDto
} from '@ghostfolio/common/dtos';
import { permissions } from '@ghostfolio/common/permissions';
import { scopes } from '@ghostfolio/common/scopes';
import type { ImpersonationContext } from '@ghostfolio/common/types';

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Param,
  Post,
  Put
} from '@nestjs/common';
import { StatusCodes } from 'http-status-codes';

import {
  RebalancingGroupNotFoundError,
  RebalancingService
} from './rebalancing.service';

/**
 * Target allocations per group of accounts, their drift and the trades to
 * rebalance them (similar to Passiv). Reading requires the scopes to read the
 * portfolio with its values, changing a group requires the scope to update an
 * account.
 */
@Controller('rebalancing')
export class RebalancingController {
  public constructor(private readonly rebalancingService: RebalancingService) {}

  @Post('groups/:id/calculate')
  @HasPermission(permissions.readRebalancing)
  @RequiresScope(scopes.portfolioRead, scopes.portfolioReadValues)
  public async calculate(
    @Body() data: CalculateRebalancingDto,
    @Impersonation() { userId }: ImpersonationContext,
    @Param('id') id: string
  ) {
    return this.handleErrors(() => {
      return this.rebalancingService.calculate({ data, id, userId });
    });
  }

  @Post('groups')
  @HasPermission(permissions.updateRebalancing)
  @RequiresScope(scopes.accountUpdate)
  public async createGroup(
    @Body() data: CreateRebalancingGroupDto,
    @Impersonation() { userId }: ImpersonationContext
  ) {
    return this.handleErrors(() => {
      return this.rebalancingService.createGroup({ data, userId });
    });
  }

  @Delete('groups/:id')
  @HasPermission(permissions.updateRebalancing)
  @RequiresScope(scopes.accountUpdate)
  public async deleteGroup(
    @Impersonation() { userId }: ImpersonationContext,
    @Param('id') id: string
  ) {
    return this.handleErrors(() => {
      return this.rebalancingService.deleteGroup({ id, userId });
    });
  }

  @Get('drift')
  @HasPermission(permissions.readRebalancing)
  @RequiresScope(scopes.portfolioRead, scopes.portfolioReadValues)
  public async getDriftOfAllGroups(
    @Impersonation() { userId }: ImpersonationContext
  ) {
    return this.handleErrors(() => {
      return this.rebalancingService.getDriftOfAllGroups({ userId });
    });
  }

  @Get('groups/:id')
  @HasPermission(permissions.readRebalancing)
  @RequiresScope(scopes.portfolioRead)
  public async getGroup(
    @Impersonation() { userId }: ImpersonationContext,
    @Param('id') id: string
  ) {
    return this.handleErrors(() => {
      return this.rebalancingService.getGroup({ id, userId });
    });
  }

  @Get('groups/:id/drift')
  @HasPermission(permissions.readRebalancing)
  @RequiresScope(scopes.portfolioRead, scopes.portfolioReadValues)
  public async getDrift(
    @Impersonation() { userId }: ImpersonationContext,
    @Param('id') id: string
  ) {
    return this.handleErrors(() => {
      return this.rebalancingService.getDrift({ id, userId });
    });
  }

  @Get('groups')
  @HasPermission(permissions.readRebalancing)
  @RequiresScope(scopes.portfolioRead)
  public async getGroups(@Impersonation() { userId }: ImpersonationContext) {
    return this.handleErrors(() => {
      return this.rebalancingService.getGroups({ userId });
    });
  }

  @Put('groups/:id')
  @HasPermission(permissions.updateRebalancing)
  @RequiresScope(scopes.accountUpdate)
  public async updateGroup(
    @Body() data: UpdateRebalancingGroupDto,
    @Impersonation() { userId }: ImpersonationContext,
    @Param('id') id: string
  ) {
    return this.handleErrors(() => {
      return this.rebalancingService.updateGroup({ data, id, userId });
    });
  }

  private async handleErrors<T>(action: () => Promise<T>) {
    try {
      return await action();
    } catch (error) {
      if (error instanceof RebalancingGroupNotFoundError) {
        throw new HttpException(error.message, StatusCodes.NOT_FOUND);
      }

      if (error instanceof CallerFacingError) {
        throw new HttpException(error.message, StatusCodes.BAD_REQUEST);
      }

      throw error;
    }
  }
}
