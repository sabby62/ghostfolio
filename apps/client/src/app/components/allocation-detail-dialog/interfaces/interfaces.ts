import { AssetProfileIdentifier } from '@ghostfolio/common/interfaces';
import { DataSource } from '@ghostfolio/prisma/enums';

export interface AllocationDetailItem {
  dataSource?: DataSource;
  isClickable: boolean;
  name: string;
  symbol: string;
  /** The value of the holding in the category */
  value: number;
  /** The share of the holding in the category, e.g. 0.25 for 25% */
  weight: number;
}

export interface AllocationDetailDialogParams {
  baseCurrency?: string;
  /** The name of the chart, e.g. "By Country" */
  chartName: string;
  deviceType?: string;
  /** True if the values are percentages of the portfolio */
  isInPercentage: boolean;
  items: AllocationDetailItem[];
  locale?: string;
  /** The name of the category, e.g. "Japan" */
  name: string;
}

export type AllocationDetailDialogResult = AssetProfileIdentifier | undefined;
