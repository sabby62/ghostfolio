import { IsBoolean, IsIn, IsNumber, IsOptional, Min } from 'class-validator';

export class CalculateRebalancingDto {
  @IsBoolean()
  @IsOptional()
  allowFractionalShares?: boolean;

  /** BUY_ONLY invests the cash without selling, FULL sells as well */
  @IsIn(['BUY_ONLY', 'FULL'])
  @IsOptional()
  mode?: 'BUY_ONLY' | 'FULL';

  /** Cash to invest in addition to the cash balance, in base currency */
  @IsNumber()
  @IsOptional()
  @Min(0)
  newCashInBaseCurrency?: number;
}
