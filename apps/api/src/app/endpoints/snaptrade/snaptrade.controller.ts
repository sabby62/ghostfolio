import { HasPermission } from '@ghostfolio/api/decorators/has-permission.decorator';
import { Impersonation } from '@ghostfolio/api/decorators/impersonation.decorator';
import { RequiresScope } from '@ghostfolio/api/decorators/requires-scope.decorator';
import { FilterDto } from '@ghostfolio/api/dtos/filter.dto';
import { CallerFacingError } from '@ghostfolio/api/errors/caller-facing.error';
import { RedactValuesInResponseInterceptor } from '@ghostfolio/api/interceptors/redact-values-in-response/redact-values-in-response.interceptor';
import { TransformDataSourceInResponseInterceptor } from '@ghostfolio/api/interceptors/transform-data-source-in-response/transform-data-source-in-response.interceptor';
import {
  CreateSnapTradeConnectionLinkDto,
  SyncSnapTradeAccountsDto,
  UpdateSnapTradeAccountDto
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
  Put,
  Query,
  UseInterceptors
} from '@nestjs/common';
import { StatusCodes } from 'http-status-codes';

import { SnapTradeHoldingsService } from './snaptrade-holdings.service';
import { SnapTradeNotFoundError, SnapTradeService } from './snaptrade.service';

/**
 * Syncs the activities, the cash balances and the positions of brokerage
 * accounts which are connected through SnapTrade. Everything which reaches
 * SnapTrade or imports activities requires the permission and the scope to
 * create activities. The synced holdings only require reading the portfolio.
 */
@Controller('snaptrade')
export class SnapTradeController {
  public constructor(
    private readonly snapTradeHoldingsService: SnapTradeHoldingsService,
    private readonly snapTradeService: SnapTradeService
  ) {}

  @Post('connection-link')
  @HasPermission(permissions.createActivity)
  @RequiresScope(scopes.activityCreate)
  public async createConnectionLink(
    @Body() data: CreateSnapTradeConnectionLinkDto,
    @Impersonation() { userId }: ImpersonationContext
  ) {
    return this.handleErrors(() => {
      return this.snapTradeService.createConnectionLink({ data, userId });
    });
  }

  @Delete('connection')
  @HasPermission(permissions.createActivity)
  @RequiresScope(scopes.activityCreate)
  public async deleteConnection(
    @Impersonation() { userId }: ImpersonationContext
  ) {
    return this.handleErrors(() => {
      return this.snapTradeService.deleteConnection({ userId });
    });
  }

  @Get('accounts')
  @HasPermission(permissions.createActivity)
  @RequiresScope(scopes.activityCreate)
  public async getAccounts(@Impersonation() { userId }: ImpersonationContext) {
    return this.handleErrors(() => {
      return this.snapTradeService.getAccounts({ userId });
    });
  }

  /**
   * The holdings as reported by the brokerages on the last sync
   */
  @Get('holdings')
  @RequiresScope(scopes.portfolioRead)
  @UseInterceptors(RedactValuesInResponseInterceptor)
  @UseInterceptors(TransformDataSourceInResponseInterceptor)
  public async getHoldings(
    @Impersonation() { userId }: ImpersonationContext,
    @Query() { accounts, assetClasses }: FilterDto
  ) {
    return this.snapTradeHoldingsService.getHoldings({
      assetClasses,
      userId,
      accountIds: accounts
    });
  }

  @Get('status')
  @HasPermission(permissions.createActivity)
  @RequiresScope(scopes.accountRead)
  public async getStatus(@Impersonation() { userId }: ImpersonationContext) {
    return this.handleErrors(() => {
      return this.snapTradeService.getStatus({ userId });
    });
  }

  @Post('sync')
  @HasPermission(permissions.createActivity)
  @RequiresScope(scopes.activityCreate)
  public async syncAccounts(
    @Body() data: SyncSnapTradeAccountsDto,
    @Impersonation() { userId }: ImpersonationContext
  ) {
    return this.handleErrors(() => {
      return this.snapTradeService.syncAccounts({
        userId,
        snapTradeAccountIds: data.snapTradeAccountIds
      });
    });
  }

  @Put('accounts/:id')
  @HasPermission(permissions.createActivity)
  @RequiresScope(scopes.activityCreate)
  public async updateAccount(
    @Body() data: UpdateSnapTradeAccountDto,
    @Impersonation() { userId }: ImpersonationContext,
    @Param('id') snapTradeAccountId: string
  ) {
    return this.handleErrors(() => {
      return this.snapTradeService.updateAccount({
        data,
        snapTradeAccountId,
        userId
      });
    });
  }

  private async handleErrors<T>(action: () => Promise<T>) {
    try {
      return await action();
    } catch (error) {
      if (error instanceof SnapTradeNotFoundError) {
        throw new HttpException(error.message, StatusCodes.NOT_FOUND);
      }

      if (error instanceof CallerFacingError) {
        throw new HttpException(error.message, StatusCodes.BAD_REQUEST);
      }

      throw error;
    }
  }
}
