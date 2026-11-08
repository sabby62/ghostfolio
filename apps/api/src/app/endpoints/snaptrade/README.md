# SnapTrade sync

Imports the activities and the cash balances of brokerage accounts (e.g.
Questrade, Wealthsimple, Interactive Brokers, moomoo) which are connected
through [SnapTrade](https://snaptrade.com). The connection is read-only: no
trade is placed.

## Configuration

| Variable                 | Default    | Description                                             |
| ------------------------ | ---------- | ------------------------------------------------------- |
| `SNAPTRADE_CLIENT_ID`    |            | Client ID of the SnapTrade API key                      |
| `SNAPTRADE_CONSUMER_KEY` |            | Consumer key of the SnapTrade API key                   |
| `SNAPTRADE_AUTH_MODE`    | `personal` | `personal` (key of one user) or `commercial` (per user) |

- **personal**: the API key belongs to your own SnapTrade account. Only one
  Ghostfolio user can connect it.
- **commercial**: every Ghostfolio user is registered as a SnapTrade user with a
  random identifier. The user secret is stored in the database.

The linked accounts are synced every 6 hours (unless `ENABLE_FEATURE_CRON` is
`false`) and on demand.

## Setup

In the app: **Settings → Brokerages** connects a brokerage, links the
accounts, sets the import date, pauses the sync and syncs now. The same steps
with the API:

1. `POST /api/v1/snaptrade/connection-link` (optional body
   `{ "broker": "QUESTRADE" }`) gives a `redirectURI`. Open it and connect the
   brokerage in the SnapTrade connection portal. To fix a disabled connection,
   pass `{ "reconnect": "<connection id>" }`.
2. `GET /api/v1/snaptrade/accounts` lists the brokerage accounts.
3. Link each one with `PUT /api/v1/snaptrade/accounts/:id`:
   - `{ "createAccount": true }` creates a Ghostfolio account and imports the
     full history.
   - `{ "accountId": "<Ghostfolio account id>" }` links an existing account.
     Only the activities after its latest activity are imported, unless
     `syncFromDate` is given (`null` imports the full history).
   - `{ "isSyncEnabled": false }` pauses the sync of the account.
4. `POST /api/v1/snaptrade/sync` (optional body
   `{ "snapTradeAccountIds": ["..."] }`) syncs now.

`GET /api/v1/snaptrade/status` gives the connection and the linked accounts
with the time and the error of their last sync. `DELETE
/api/v1/snaptrade/connection` removes the connection (the imported activities
stay).

## What is imported

| SnapTrade                                | Ghostfolio                             |
| ---------------------------------------- | -------------------------------------- |
| `BUY`, `REI`                             | `BUY`                                  |
| `SELL`                                   | `SELL`                                 |
| `DIVIDEND`, `SUBSTITUTE_DIVIDEND`        | `DIVIDEND`                             |
| `INTEREST`                               | `INTEREST`                             |
| `FEE`, `TAX`                             | `FEE`                                  |
| `CONTRIBUTION`, `WITHDRAWAL`, `TRANSFER` | skipped (the cash balance covers them) |
| options, crypto, splits, other           | skipped                                |

- The symbols use the ticker format of Yahoo Finance (e.g. `XEQT.TO`) with the
  data source of the import (`DATA_SOURCE_IMPORT`, default `YAHOO`).
- Every activity is imported once: the imported SnapTrade activities are
  remembered per account.
- An activity which cannot be imported (e.g. an unknown symbol) is reported
  and retried with the next sync.
- The cash balance of the account is set to the cash of the brokerage account,
  converted to the currency of the account.

## Holdings as reported by the brokerage

Every sync also stores the positions (quantity, price and average cost per
share) and the cash balances per currency as the brokerage reports them.
Ghostfolio keeps calculating its own holdings from the activities for the
charts, the performance and the dividends, while these numbers match the
brokerage exactly:

- `GET /api/v1/snaptrade/holdings` returns them in the format of the holdings
  of Ghostfolio (filters: `accounts`, `assetClasses`)
- **Overview → Holdings** has a _Broker_ / _Ghostfolio_ toggle (default
  _Broker_ once a sync stored positions)
- **Portfolio → Rebalancing** takes the holdings of synced accounts from the
  brokerage and the ones of other accounts from Ghostfolio, and says which

Options, futures, CFDs, bonds and tokenized assets are not stored, as their
value is not units times price. Positions counted in the cash balance
(`cash_equivalent`) are left out to avoid counting them twice.

## MCP tools

- `get-snaptrade-accounts`: the connection and the linked accounts
- `sync-snaptrade-accounts`: syncs the linked accounts (needs the permission
  "View and manage" or "Restricted view and manage")
