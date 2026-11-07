import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested
} from 'class-validator';

import { RebalancingTargetDto } from './rebalancing-target.dto';

export class UpdateRebalancingGroupDto {
  /** The accounts of the group, all accounts if empty */
  @ArrayMaxSize(100)
  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  accountIds?: string[];

  /** Fraction, e.g. 0.05 for 5 percentage points */
  @IsNumber()
  @IsOptional()
  @Max(1)
  @Min(0)
  driftThresholdInPercentage?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @MinLength(1)
  name?: string;

  /** Replaces all targets of the group if given */
  @ArrayMaxSize(200)
  @IsArray()
  @IsOptional()
  @Type(() => RebalancingTargetDto)
  @ValidateNested({ each: true })
  targets?: RebalancingTargetDto[];
}
