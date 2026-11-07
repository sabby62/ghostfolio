import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateSnapTradeConnectionLinkDto {
  /** The slug of the brokerage to preselect, e.g. QUESTRADE */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  broker?: string;

  /** The identifier of a disabled brokerage connection to reconnect */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  reconnect?: string;
}
