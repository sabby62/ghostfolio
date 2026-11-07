import { DATE_RANGE_PATTERN } from '@ghostfolio/api/dtos/date-range-filter.dto';
import { isValidEncodedDataSource } from '@ghostfolio/api/helper/data-source.helper';
import {
  COMMENT_MAXIMUM_LENGTH,
  DATE_RANGES,
  DEFAULT_DATE_RANGE,
  MCP_MAX_ACCOUNTS,
  MCP_MAX_ACTIVITIES,
  SEARCH_QUERY_MAXIMUM_LENGTH,
  SEARCH_QUERY_MINIMUM_LENGTH,
  SYMBOL_MAXIMUM_LENGTH
} from '@ghostfolio/common/config';
import {
  isValidAccountBalanceDate,
  isValidCurrencyCode,
  isValidDateAfter1970
} from '@ghostfolio/common/helper';

import { AssetClass, DataSource, Type as ActivityType } from '@prisma/client';
import { z } from 'zod';

const DATA_SOURCE_PARAMETER_ERROR = `Invalid option: expected one of ${Object.values(DataSource).join('|')} or a data source as given by a tool`;

const DATA_SOURCE_PARAMETER = z
  .union(
    [
      z.enum(DataSource),
      z.string().refine(isValidEncodedDataSource, {
        error: DATA_SOURCE_PARAMETER_ERROR
      })
    ],
    { error: DATA_SOURCE_PARAMETER_ERROR }
  )
  .describe('The data source of the asset profile');

const SYMBOL_PARAMETER = z
  .string()
  .trim()
  .min(1)
  .max(SYMBOL_MAXIMUM_LENGTH)
  .describe('The symbol of the asset profile');

const HOLDING_PARAMETER = z.object({
  dataSource: DATA_SOURCE_PARAMETER,
  symbol: SYMBOL_PARAMETER
});

export const GET_ACCOUNTS_PARAMETERS = z.object({
  accountIds: z
    .array(z.string().min(1))
    .min(1)
    .max(MCP_MAX_ACCOUNTS)
    .optional()
    .describe(
      `The identifiers of the accounts to get, at most ${MCP_MAX_ACCOUNTS}`
    ),
  assetClasses: z
    .array(z.enum(AssetClass))
    .min(1)
    .optional()
    .describe('The asset classes of the accounts to get'),
  holding: HOLDING_PARAMETER.optional().describe(
    'The asset profile of the accounts to get'
  )
});

export const GET_ACTIVITIES_PARAMETERS = z.object({
  activityTypes: z
    .array(z.enum(ActivityType))
    .min(1)
    .optional()
    .describe('The types of the activities to get'),
  assetClasses: z
    .array(z.enum(AssetClass))
    .min(1)
    .optional()
    .describe('The asset classes of the activities to get'),
  holding: HOLDING_PARAMETER.optional().describe(
    'The asset profile of the activities to get'
  ),
  range: z
    .string()
    .regex(DATE_RANGE_PATTERN)
    .optional()
    .describe(
      `The date range of the activities to get, either ${DATE_RANGES.join(
        ', '
      )} or a calendar year like 2024`
    ),
  skip: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('The number of activities to skip'),
  take: z
    .number()
    .int()
    .min(1)
    .max(MCP_MAX_ACTIVITIES)
    .default(MCP_MAX_ACTIVITIES)
    .describe(`The number of activities to get, at most ${MCP_MAX_ACTIVITIES}`)
});

export const GET_PERFORMANCE_PARAMETERS = z.object({
  accountIds: z
    .array(z.string().min(1))
    .min(1)
    .max(MCP_MAX_ACCOUNTS)
    .optional()
    .describe(
      `The identifiers of the accounts of the performance, at most ${MCP_MAX_ACCOUNTS}`
    ),
  assetClasses: z
    .array(z.enum(AssetClass))
    .min(1)
    .optional()
    .describe('The asset classes of the performance'),
  holding: HOLDING_PARAMETER.optional().describe(
    'The asset profile of the performance'
  ),
  range: z
    .string()
    .regex(DATE_RANGE_PATTERN)
    .default(DEFAULT_DATE_RANGE)
    .describe(
      `The date range of the performance, either ${DATE_RANGES.join(
        ', '
      )} or a calendar year like 2024`
    )
});

export const IMPORT_ACTIVITIES_PARAMETERS = z.object({
  activities: z
    .array(
      z.object({
        accountId: z
          .string()
          .min(1)
          .optional()
          .describe('The identifier of the account of the activity'),
        comment: z
          .string()
          .trim()
          .max(COMMENT_MAXIMUM_LENGTH)
          .optional()
          .describe('The comment of the activity'),
        currency: z
          .string()
          .refine(isValidCurrencyCode)
          .describe(
            'The currency of the fee and of the unit price, as an ISO 4217 code in upper case'
          ),
        dataSource: DATA_SOURCE_PARAMETER.optional(),
        date: z
          .string()
          .refine(isValidDateAfter1970)
          .describe(
            'The date of the activity, as an ISO 8601 date or date and time'
          ),
        fee: z.number().min(0).describe('The fee of the activity'),
        quantity: z.number().min(0).describe('The quantity of the activity'),
        symbol: SYMBOL_PARAMETER,
        type: z.enum(ActivityType).describe('The type of the activity'),
        unitPrice: z.number().min(0).describe('The unit price of the activity')
      })
    )
    .min(1)
    .max(MCP_MAX_ACTIVITIES)
    .describe(`The activities to import, at most ${MCP_MAX_ACTIVITIES}`)
});

export const SEARCH_ASSET_PROFILES_PARAMETERS = z.object({
  query: z
    .string()
    .trim()
    .min(SEARCH_QUERY_MINIMUM_LENGTH)
    .max(SEARCH_QUERY_MAXIMUM_LENGTH)
    .describe(
      'The name, ticker symbol or ISIN of the financial asset, for example Apple, AAPL, Bitcoin or US0378331005'
    )
});

export const UPDATE_ACCOUNT_BALANCE_PARAMETERS = z.object({
  accountId: z.string().min(1).describe('The identifier of the account'),
  balance: z
    .number()
    .describe('The cash balance of the account in the currency of the account'),
  date: z.iso
    .date({
      abort: true,
      error: 'The date must be an ISO 8601 date, for example 2024-01-01'
    })
    .refine(isValidDateAfter1970, {
      error: 'The date must be after 1970-01-01'
    })
    .refine(isValidAccountBalanceDate, {
      error: 'The date must not be in the future'
    })
    .describe('The date of the cash balance, as an ISO 8601 date')
});

const REBALANCING_GROUP_ID_PARAMETER = z
  .string()
  .trim()
  .min(1)
  .describe('The identifier of the rebalancing group, as given by a tool');

export const CALCULATE_REBALANCING_PARAMETERS = z.object({
  allowFractionalShares: z
    .boolean()
    .optional()
    .describe(
      'Whether fractional shares can be traded (default: false, whole shares only)'
    ),
  groupId: REBALANCING_GROUP_ID_PARAMETER,
  mode: z
    .enum(['BUY_ONLY', 'FULL'])
    .optional()
    .describe(
      'BUY_ONLY invests the available cash without selling (default), FULL sells the overweight holdings and the holdings without target as well'
    ),
  newCashInBaseCurrency: z
    .number()
    .min(0)
    .optional()
    .describe(
      'Cash to invest in addition to the cash balance of the accounts, in the base currency of the user (default: 0)'
    )
});

export const GET_REBALANCING_DRIFT_PARAMETERS = z.object({
  groupId: REBALANCING_GROUP_ID_PARAMETER.optional().describe(
    'The identifier of the rebalancing group, all groups if omitted'
  )
});

export const SET_REBALANCING_GROUP_PARAMETERS = z.object({
  accountIds: z
    .array(z.string().min(1))
    .max(MCP_MAX_ACCOUNTS)
    .optional()
    .describe(
      'The identifiers of the accounts of the group as given by get-accounts, all accounts if empty or omitted'
    ),
  driftThresholdInPercentage: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe(
      'The drift from the target which needs a rebalancing, as a fraction (default: 0.05 for 5 percentage points)'
    ),
  groupId: REBALANCING_GROUP_ID_PARAMETER.optional().describe(
    'The identifier of the rebalancing group to replace, a new group is created if omitted'
  ),
  name: z.string().trim().min(1).max(100).describe('The name of the group'),
  targets: z
    .array(
      z.object({
        dataSource: DATA_SOURCE_PARAMETER,
        symbol: SYMBOL_PARAMETER,
        targetInPercentage: z
          .number()
          .min(0)
          .max(1)
          .describe('The target as a fraction of the group, e.g. 0.25 for 25%')
      })
    )
    .max(200)
    .describe(
      'All targets of the group, which replace the existing targets. The sum must not exceed 1, the rest is the target of the cash'
    )
});

export const SYNC_SNAPTRADE_ACCOUNTS_PARAMETERS = z.object({
  snapTradeAccountIds: z
    .array(z.string().min(1))
    .min(1)
    .max(MCP_MAX_ACCOUNTS)
    .optional()
    .describe(
      'The identifiers of the SnapTrade accounts to sync as given by get-snaptrade-accounts, all linked accounts with an enabled sync if omitted'
    )
});
