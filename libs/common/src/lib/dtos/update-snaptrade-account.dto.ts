import {
  IsBoolean,
  IsISO8601,
  IsOptional,
  IsString,
  ValidateIf
} from 'class-validator';

export class UpdateSnapTradeAccountDto {
  /** The Ghostfolio account to sync into, null to unlink */
  @IsOptional()
  @IsString()
  @ValidateIf((_, value) => value !== null)
  accountId?: string | null;

  /** Creates a new Ghostfolio account for the SnapTrade account */
  @IsBoolean()
  @IsOptional()
  createAccount?: boolean;

  @IsBoolean()
  @IsOptional()
  isSyncEnabled?: boolean;

  /**
   * The activities before this date are not imported, e.g. because they are
   * imported already. Null imports the full history.
   */
  @IsISO8601()
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  syncFromDate?: string | null;
}
