import { PortfolioPosition } from '@ghostfolio/common/interfaces';

export interface HoldingsTableItem
  extends
    Pick<
      PortfolioPosition,
      | 'allocationInPercentage'
      | 'assetProfile'
      | 'dateOfFirstActivity'
      | 'netPerformancePercentWithCurrencyEffect'
    >,
    Partial<
      Pick<
        PortfolioPosition,
        | 'averagePrice'
        | 'investmentWithCurrencyEffect'
        | 'netPerformanceWithCurrencyEffect'
        | 'quantity'
        | 'valueInBaseCurrency'
      >
    > {}
