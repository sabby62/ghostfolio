import { ArrayMaxSize, IsArray, IsOptional, IsString } from 'class-validator';

export class SyncSnapTradeAccountsDto {
  /** The SnapTrade accounts to sync, all linked accounts if omitted */
  @ArrayMaxSize(100)
  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  snapTradeAccountIds?: string[];
}
