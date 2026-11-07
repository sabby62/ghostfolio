import { SYMBOL_MAXIMUM_LENGTH } from '@ghostfolio/common/config';

import { IsNumber, IsString, Max, MaxLength, Min } from 'class-validator';

export class RebalancingTargetDto {
  /** A data source, which can be encoded as given in a response */
  @IsString()
  @MaxLength(SYMBOL_MAXIMUM_LENGTH)
  dataSource: string;

  @IsString()
  @MaxLength(SYMBOL_MAXIMUM_LENGTH)
  symbol: string;

  /** Fraction of the group, e.g. 0.25 for 25% */
  @IsNumber()
  @Max(1)
  @Min(0)
  targetInPercentage: number;
}
