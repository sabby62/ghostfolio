# Rebalancing (Passiv-style target allocations)

A **rebalancing group** is a set of accounts (all accounts if empty) with a
target allocation per holding and a drift threshold. Ghostfolio compares the
holdings of the group with the targets and calculates the trades which bring
them back to the targets. No trade is placed: you place the trades at your
broker.

All percentages are fractions (`0.25` = 25%) and all values are in the base
currency of the user. The rest of the targets (`1 - sum`) is the target of the
cash, which is kept as a reserve.

## REST API (`/api/v1/rebalancing`)

| Method | Path                    | Description                             |
| ------ | ----------------------- | --------------------------------------- |
| GET    | `/groups`               | List the groups with their targets      |
| POST   | `/groups`               | Create a group                          |
| GET    | `/groups/:id`           | Get a group                             |
| PUT    | `/groups/:id`           | Update a group (`targets` replaces all) |
| DELETE | `/groups/:id`           | Delete a group                          |
| GET    | `/drift`                | Drift of all groups                     |
| GET    | `/groups/:id/drift`     | Drift of a group                        |
| POST   | `/groups/:id/calculate` | Trades to rebalance a group             |

Create a group:

```json
{
  "name": "TFSA",
  "accountIds": ["<account id>"],
  "driftThresholdInPercentage": 0.05,
  "targets": [
    { "dataSource": "YAHOO", "symbol": "XEQT.TO", "targetInPercentage": 0.6 },
    { "dataSource": "YAHOO", "symbol": "VFV.TO", "targetInPercentage": 0.4 }
  ]
}
```

Calculate the trades:

```json
{
  "mode": "BUY_ONLY",
  "newCashInBaseCurrency": 1000,
  "allowFractionalShares": false
}
```

- `BUY_ONLY` (default) invests the cash of the accounts plus the new cash
  without selling. The cash goes to the most underweight targets first.
- `FULL` sells the overweight holdings and the holdings without target as well.
- A holding of the accounts without a target has a target of 0.
- A target which is not held yet is priced with a quote of its data provider.

## MCP tools

The built-in MCP endpoint (`/mcp`, requires `ENABLE_FEATURE_MCP=true` and a
`ROOT_URL` with the host which the client uses) adds these tools:

- `get-rebalancing-groups`: the groups and their targets
- `get-rebalancing-drift`: the drift of one or all groups
- `calculate-rebalancing`: the trades to rebalance a group
- `set-rebalancing-group`: create or replace a group (needs the permission
  "View and manage" or "Restricted view and manage")

The drift and the calculation need an access which reads the monetary values
("View" or "View and manage").
