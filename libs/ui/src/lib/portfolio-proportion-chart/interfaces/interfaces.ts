import { AssetProfileIdentifier } from '@ghostfolio/common/interfaces';

export type PortfolioProportionChartClickEvent =
  AssetProfileIdentifier | { accountId: string };

/**
 * A category (slice) of the chart, e.g. a currency or a sector
 */
export interface PortfolioProportionChartCategoryClickEvent {
  /** The keys of the category, several for the group of other categories */
  keys: string[];
  name: string;
  /** The subcategory, if the click is on the outer ring of two keys */
  subCategory?: string;
}
