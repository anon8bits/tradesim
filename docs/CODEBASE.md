# TradeSim codebase guide

This is a reading guide for the repository as it exists today. It explains
what the system does, how a request moves through it, and what each source
file is for. The shorter design notes live in `docs/ARCHITECTURE.md`, the
"why we chose X" log lives in `docs/DECISIONS.md`, and the phase checklist
lives in `docs/TASKS.md`. This file is the walkthrough of the code those
docs describe.

TradeSim is a paper-trading simulator. A person signs in with Auth0, gets
one virtual trading account with ₹1,00,000, and can buy and sell a fixed
list of 100 NSE equities at real (delayed) prices. No real money moves.
The engineering goal is a correct concurrent ledger: balances, holdings,
and orders stay consistent when many orders hit the same account at once.

## How the pieces fit

Three long-running processes, plus two infrastructure processes:

| Process | Package | What it does | Port |
|---|---|---|---|
| API | `@tradesim/api` (`apps/api`) | HTTP only. Auth, account opening, prices, portfolio, order intake. Never executes a trade. | 3000 |
| Worker | `@tradesim/worker` (`apps/worker`) | No HTTP server. Consumes the order queue and holds the Upstox market-data connection. | none |
| Web | `@tradesim/web` (`apps/web`) | Vite + React SPA. Talks only to the API. | 5173 |
| Postgres 16 | Docker | Users, holdings, orders, ledger, price history. | 5432 |
| Redis 7 | Docker | Price cache, pub/sub, BullMQ. | 6379 |

Adminer (port 8080) is a database UI in front of Postgres. It is not part
of the application.

```text
Browser (apps/web)
    |  Bearer access token
    |  Vite proxies /api/* -> localhost:3000 and strips the /api prefix
    v
NestJS API (apps/api)
    |-- Auth0 JWKS          validate the JWT
    |-- Auth0 /userinfo     only on the first POST /me, to read the email
    |-- Postgres            users, holdings, orders, ledger, price snapshots
    |-- Redis               read price:{SYMBOL}; enqueue BullMQ jobs
    v
Worker (apps/worker)          same Postgres, same Redis, separate process
    |-- BullMQ "orders"     one job at a time, globally
    |-- Upstox              WebSocket feed while NSE is open; REST LTP when closed
    |-- Redis               write price:{SYMBOL}; publish price.ticks and order.events
    |-- Postgres            append PriceSnapshot rows; mutate balances inside one transaction
```

Phase 7 (a WebSocket gateway on the API that would forward those Redis
channels to the browser) is not built. The browser polls HTTP instead.
Nothing in the API subscribes to `price.ticks` or `order.events` yet.
The worker still publishes them so that gateway can be added later
without changing ingestion or execution.

## Money

Every amount that is calculated is an integer number of paise, stored as
`BigInt`. One rupee is 100 paise. ₹1,00,000 is `10_000_000n`, exported as
`STARTING_CASH_BALANCE_PAISE` from `@tradesim/common`.

JSON cannot carry `BigInt`, and a JavaScript `number` cannot hold every
integer paise value safely. So:

- Postgres columns are `BIGINT`.
- Services keep `bigint`.
- Redis values and HTTP bodies encode paise as base-10 strings
  (`"294550"` means ₹2,945.50).
- The browser parses those strings back to `bigint` before any arithmetic.
- Display formatting (`paiseToDisplayRupees`, then Indian digit grouping
  in the web app) happens only when rendering a string.
- The stock chart is the one place a price becomes a JS `number`, and only
  as a pixel ratio. That number is never written back into a balance.

Upstox sends prices as protobuf/JSON doubles (rupees). `wireRupeesToPaise`
turns that provider value into a decimal string immediately, then rounds
to paise with `BigInt`. Rounding looks at the third decimal digit
(half-up). After that boundary, no monetary math uses a JS number.

Two holding fields exist on purpose:

- `costBasisCents` is the exact aggregate amount paid for the shares still
  held. Buys add the exact trade value. Sells subtract a proportional
  slice. Integer division truncates, and the leftover paise stay with the
  shares still held. A full sell leaves quantity, basis, and average at 0,
  but the holding row stays.
- `avgCostCents` is the display average: `costBasisCents / quantity`,
  integer division. It is not used to compute P&L. Using only the rounded
  average would drift after many buys.

P&L for a holding is `currentPrice * quantity - costBasisCents`. Portfolio
totals are sums of those `bigint`s. Quantity-zero holdings are omitted and
do not trigger a price lookup.

Database `CHECK` constraints back this up even if a write skips the HTTP
validator: cash, quantity, average cost, and cost basis cannot be
negative; order quantity and snapshot prices must be positive; a fill
price is either null or positive.

## Data model

Defined in `libs/db/prisma/schema.prisma`. Table names are snake_case via
`@@map`; Prisma model names are PascalCase.

### `User` → table `users`

One trading account. `auth0Id` is unique (one account per login identity).
`email` is unique and stored lowercase (one account per email, across
Google and email/password). `cashBalanceCents` is the spendable virtual
cash. Opening an account sets it to ₹1,00,000 and writes a matching ledger
row in the same transaction, so the ledger explains the balance from the
first day.

The seed creates `trader1@example.com` / `auth0|seed-trader1` and
`trader2@example.com` / `auth0|seed-trader2`. The upsert's `update` is
empty, so re-seeding does not overwrite an `auth0Id` that was later pointed
at a real Auth0 user.

### `Holding` → table `holdings`

One row per `(userId, symbol)`. `quantity` is a whole number of shares.
See the money section for `avgCostCents` vs `costBasisCents`. A fully sold
position is a row with zeros, not a deleted row. Portfolio reads ignore
`quantity = 0`.

### `Order` → table `orders`

What was requested, and whether it has been applied.

| Column | Meaning |
|---|---|
| `side` | `BUY` or `SELL` |
| `quantity` | Shares requested. Must be > 0. |
| `status` | `PENDING` (default), `FILLED`, or `REJECTED` |
| `fillPriceCents` | Set only by the worker, from the latest `PriceSnapshot`. Null until then. The API never guesses a price. |
| `rejectionReason` | `INSUFFICIENT_FUNDS`, `INSUFFICIENT_SHARES`, `PRICE_UNAVAILABLE`, or null |
| `eventPublishedAt` | When the post-commit Redis event was published. Null means "publish still owed". |
| `processedAt` | When the worker finished the order (fill or rejection). |
| `createdAt` | When the API accepted it. |

Indexed on `(userId, status)` so the worker can find `PENDING` rows quickly.

An order has no effect on cash until the worker commits. That is why
`Order` and `Transaction` are separate tables.

### `Transaction` → table `transactions`

Append-only ledger. `type` is a string, not an enum yet:

- `DEPOSIT` — opening ₹1,00,000. Positive. No `orderId`.
- `TRADE_BUY` — cash leaving the account. Negative `amountCents`.
- `TRADE_SELL` — cash entering the account. Positive `amountCents`.

`amountCents` is signed: negative debits cash, positive credits it.
`orderId` is optional; deleting an order would set it null
(`ON DELETE SET NULL`). User foreign keys are `ON DELETE RESTRICT`.

There is no database trigger that checks "sum of transactions = cash".
The application writes both in one transaction and the tests check the
result.

### `PriceSnapshot` → table `price_snapshots`

A time series, not "the current price". Current price is "latest row for
this symbol", backed by Redis key `price:{SYMBOL}`. Indexed on
`(symbol, ts)`. The worker appends; it does not update rows in place.
Re-running the seed deletes and recreates the three fake rows for
`RELIANCE`, `TCS`, and `INFY` (₹2,945.50, ₹3,812.25, ₹1,540.00). A re-seed
wipes any live snapshots for those three symbols.

### Migrations

1. `libs/db/prisma/migrations/20260905190945_init/migration.sql` — enums,
   five tables, uniques, indexes, foreign keys.
2. `20260913141000_order_event_delivery` — `rejectionReason`,
   `eventPublishedAt`, and the financial `CHECK` constraints.
3. `20260913143000_exact_holding_cost_basis` — adds `costBasisCents`,
   backfills it as `avgCostCents * quantity`, and constrains it to be
   non-negative.

`migration_lock.toml` pins the provider to PostgreSQL.

## Shared contracts

`libs/common/src/index.ts` is the wire vocabulary both processes share:

| Export | Role |
|---|---|
| `PriceTick` | `{ symbol, priceCents: bigint, ts: ISO string }` |
| `PRICE_TICKS_CHANNEL` | Redis pub/sub channel `"price.ticks"` |
| `ORDER_QUEUE_NAME` | BullMQ queue `"orders"` |
| `ORDER_DEAD_LETTER_QUEUE_NAME` | `"orders-dead-letter"` |
| `ORDER_EVENTS_CHANNEL` | Redis pub/sub channel `"order.events"` |
| `OrderJobData` | `{ orderId, userId }` — the only payload on a job. The worker re-reads the order from Postgres. |
| `OrderExecutionEvent` | JSON published after commit. Money fields on it are strings. `status` is `FILLED` or `REJECTED`. |
| `paiseToDisplayRupees` | `bigint` → `"2945.50"` (no ₹ symbol, no grouping) |
| `rupeesToPaise` | Strict decimal string → `bigint`. Rejects floats and more than 2 decimal places. |
| `wireRupeesToPaise` | Upstox double → paise, half-up on the third decimal. Rejects non-finite and non-positive. |
| `STARTING_CASH_BALANCE_PAISE` | `10_000_000n` |
| `CURATED_INDEX_SYMBOLS` | Empty array. `GET /indices` therefore returns `[]` until index instruments are added as their own catalog. |

`libs/common/src/instrument-catalog.ts` loads
`libs/common/src/data/nse-top-100.json` at import time and throws if the
file is wrong. The rules:

- Exactly 100 entries.
- Each entry is an NSE equity: `segment = NSE_EQ`, `exchange = NSE`,
  `instrument_type = EQ`.
- `instrument_key` must equal `NSE_EQ|{isin}`.
- `trading_symbol` and `instrument_key` are unique.
- `short_name` is optional; blank becomes null.

Fields present in the JSON but ignored by the loader: `lot_size`,
`freeze_quantity`, `exchange_token`, `tick_size`, `qty_multiplier`,
`security_type`, `cas_eligible`.

Exports built from that load:

- `NSE_TOP_100` — frozen array of `InstrumentCatalogEntry`.
- `CURATED_SYMBOLS` / `CURATED_INSTRUMENT_KEYS`.
- `INSTRUMENT_BY_SYMBOL` / `INSTRUMENT_BY_KEY`.

The API searches this list in memory. The worker subscribes to every key.
A user search never calls Upstox. Importing this module is also the
startup check: a bad catalog fails the process before it serves traffic.

`libs/db/src/index.ts` constructs one `PrismaClient` at import
(`export const prisma`) and re-exports the generated Prisma types. The
worker uses that singleton. The API does not: it has its own injectable
`PrismaService extends PrismaClient`, so an API process actually
constructs two clients (the unused singleton from the import, and the
Nest service). `DATABASE_URL` must exist before either import runs. That
is why the root `dev:api` / `dev:worker` scripts load `.env` with
`dotenv-cli` before the process starts, and why they build `libs/common`
and `libs/db` first. Nest resolves the compiled `dist` entry points, not
the TypeScript source. The web app is the exception: Vite aliases
`@tradesim/common` to `libs/common/src/index.ts` because the published
package is CommonJS and the browser build needs the TypeScript source.

## Redis keys and channels

| Key / name | Written by | Read by | Shape |
|---|---|---|---|
| `price:{SYMBOL}` | Worker `TickHandler` on every tick. API `MarketService` on a cache miss (best-effort). | API `MarketService.getStock` | JSON `{ symbol, priceCents: string, ts }` |
| `price.ticks` | `TickHandler` after the cache write | Nobody yet (Phase 7) | Same JSON |
| `order.events` | `executeOrder` after the DB commit | Nobody yet (Phase 7) | `OrderExecutionEvent` JSON |
| BullMQ queue `orders` | API `OrdersService`, and the worker reconciliation loop | Worker `Worker` | Job name `execute-order`, data `{ orderId, userId }`, `jobId = orderId` |
| BullMQ queue `orders-dead-letter` | Worker `failed` handler after retries are exhausted | Nobody consumes it; it is an alert sink | Job name `failed-order`, same ids plus `failedReason` and `failedAt` |

Cache reads and writes are best-effort. A Redis outage or a malformed
cache value makes `getStock` fall through to the latest `PriceSnapshot`
and still return a price. A failed cache write is logged and ignored.

Order execution does not read Redis for the fill price. It reads the
latest `PriceSnapshot` inside the database transaction. The browser can
therefore show a price that is newer than the price a fill will use,
by up to one flush interval (5 seconds) plus however stale the snapshot
is. When the market is closed, both sides show the closing LTP that the
worker loaded once for that closed period.

## HTTP API

There is no global path prefix and no CORS. Routes are the Nest controller
paths. In development the browser calls `/api/portfolio` and Vite rewrites
that to `http://localhost:3000/portfolio`.

Global `ValidationPipe` (`apps/api/src/main.ts`): `transform` (query
strings become numbers), `whitelist` (unknown fields dropped),
`forbidNonWhitelisted` (unknown fields are a 400).

Global `JwtAuthGuard`. The only public route is `GET /health`, marked
`@Public()`. Every other route requires `Authorization: Bearer <access token>`.
Passport puts the validated payload on `request.user` as
`{ sub, permissions? }`. `permissions` is unused. `sub` is the Auth0 user
id (`google-oauth2|…` or `auth0|…`) and is how every feature finds the
`users` row.

JWT checks (`jwt.strategy.ts`): bearer token, algorithm RS256 only,
audience equals `AUTH0_AUDIENCE`, issuer is `https://{AUTH0_DOMAIN}/`.
The signing key comes from `{issuer}.well-known/jwks.json`, cached, at
most 5 JWKS requests per minute. A domain configured with or without
`https://` is normalized.

| Method and path | Auth | Success | What it does |
|---|---|---|---|
| `GET /health` | Public | 200 `{ status: "ok", userCount }` | `SELECT count(*)` on `users`. Proves Postgres, not just process boot. |
| `POST /me` | Bearer | 201 if this call created the account, 200 if it already existed | Idempotent account open. Body is `AccountResponseDto`. |
| `GET /indices` | Bearer | 200 array, currently always `[]` | Would price `CURATED_INDEX_SYMBOLS`. That list is empty. |
| `GET /stocks?query&page&limit` | Bearer | 200 catalog page | In-memory search of the 100 names. No Upstox call. |
| `GET /stocks/:symbol` | Bearer | 200 price, or 404 | Cache-aside current price. Symbol is uppercased. |
| `GET /portfolio` | Bearer | 200 portfolio, 404 if no user row | Cash, active holdings, BigInt P&L. 503 if a held symbol has no price. |
| `POST /orders` | Bearer | 202 `{ id, symbol, side, quantity, status: "PENDING", createdAt }` | Inserts the order, best-effort enqueue. Does not check cash or shares. |

There is no `GET /orders`, no order-status endpoint, and no price-history
endpoint. The UI works around both; see the frontend section.

### `POST /me` in detail

`AccountsController` pulls the raw bearer token back off the header
because the access token's claims do not include email. Auth0 access
tokens for this API carry `sub` only. The email is read from
`https://{AUTH0_DOMAIN}/userinfo` with that same token, once, and only
when no `users` row exists for this `sub`.

1. `findUnique` by `auth0Id`. If found, return 200 and do not call Auth0.
2. `GET /userinfo`. Map failures: network or unexpected HTTP → 502,
   401/403 → 401, 429 → 503. Email is trimmed and lowercased. Missing
   email becomes null.
3. `userinfo.sub` must equal the JWT `sub`, or 401.
4. No email → 403 `EMAIL_MISSING`.
5. `email_verified !== true` → 403 `EMAIL_NOT_VERIFIED`. An unverified
   password sign-up cannot reserve an address before the owner signs in
   with Google.
6. If another `users` row already has this email → 409 `EMAIL_IN_USE`.
   The message names the other method: `google-oauth2` → "Google",
   `auth0` → "email and password", anything else → "a different sign-in
   method". Accounts are never linked or merged.
7. Otherwise one transaction: insert `users` with
   `STARTING_CASH_BALANCE_PAISE`, insert `transactions` type `DEPOSIT`
   for the same amount. Response 201 with `created: true`.

Two first-time requests can race. The loser hits Postgres unique
violation `P2002`. It re-reads by `auth0Id`. If the winner was the same
login, it returns that row with `created: false`. If a different login
took the email, it throws 409.

The Auth0 Action in
`infra/auth0/pre-user-registration-block-duplicate-email.js` is a nicer
version of the same rule on the email/password sign-up form. It runs
only for database sign-ups (Google never hits Pre User Registration).
It calls the Auth0 Management API `users-by-email` with a machine-to-machine
token and denies the sign-up if any user already has that email. If the
Management API call fails, the Action logs and allows the sign-up
(fail open). `POST /me` is the authoritative check. Installing the Action
is a manual dashboard step; the file in the repo does nothing until it
is pasted into Auth0.

### Market read path

`MarketService.getStock`:

1. Uppercase and trim the symbol. Key is `price:{SYMBOL}`.
2. `GET` the Redis string. Parse JSON. `priceCents` must match `^-?\d+$`.
   Convert with `BigInt`. Any throw or Redis error is treated as a miss.
3. On a miss, `priceSnapshot.findFirst` where `symbol`, `orderBy ts desc`.
   No row → `null` (the controller turns that into 404).
4. Best-effort `SET` the cache with the string form, then return.

`searchStocks` filters `NSE_TOP_100` case-insensitively (`en` locale)
across trading symbol, legal name, short name, and ISIN. Empty query
returns the full catalog. Pagination is `slice` on that array. Defaults:
`page = 1`, `limit = 20`, max limit 100, query max length 100.
`totalPages` is `ceil(total / limit)`.

`GET /stocks` is declared before `GET /stocks/:symbol` in the controller
so the collection route is not captured as a symbol.

### Portfolio read path

`PortfolioService.getPortfolio(auth0Id)`:

1. Load the user and all holdings. No row → 404 "Trading profile not found".
2. Drop `quantity <= 0`.
3. For each remaining holding, `MarketService.getStock`. No price → 503
   `Current price unavailable for {symbol}` (the whole response fails;
   it does not return a partial portfolio).
4. `marketValue = price * BigInt(quantity)`.
5. `unrealizedPnl = marketValue - costBasisCents`.
6. Totals: sum of market values, sum of P&Ls, `total = cash + holdings value`.

The DTO converts every `bigint` to a decimal string.

### Order intake

`CreateOrderDto`: `symbol` trimmed and uppercased, must match
`^[A-Z0-9][A-Z0-9._-]{0,19}$` (1–20 characters), `side` is the Prisma
enum `BUY` | `SELL`, `quantity` is an integer from 1 to 1,000,000.
The symbol is not checked against the top-100 catalog. A symbol with no
`PriceSnapshot` is accepted by the API and later rejected by the worker
as `PRICE_UNAVAILABLE`.

`OrdersService.create`:

1. Resolve `auth0Id` → internal user id. Missing → 404.
2. `order.create` with default status `PENDING`. This commit is the
   point of no return: the handler returns 202 after this even if Redis
   is down.
3. `queue.add("execute-order", { orderId, userId }, { jobId: order.id,
   attempts: 5, backoff: exponential 1s, removeOnComplete: 1000,
   removeOnFail: false })`.
4. Enqueue errors are logged and swallowed. The reconciliation loop will
   retry. Using `jobId = order.id` means BullMQ will not create a second
   job for the same order.

The API never reads `cashBalanceCents` or holdings here. A buy the user
cannot afford is still 202; the worker rejects it.

BullMQ's connection is separate from `RedisService`. `OrdersModule`
parses `REDIS_URL` into host, port, username, password, db index, and
TLS when the scheme is `rediss:`.

## Worker

`apps/worker/src/index.ts` is the whole process:

1. Require `REDIS_URL`. Require `UPSTOX_ANALYTICS_TOKEN` (non-empty,
   at least 20 characters, no whitespace) via `requireAnalyticsToken`.
2. `startOrderProcessor(redisUrl)` — BullMQ consumer, reconciliation
   timer, dead-letter queue.
3. A second ioredis client (`maxRetriesPerRequest: 2`) for ticks.
4. `SnapshotFlusher` every 5 seconds, `TickHandler`, `UpstoxMarketCalendar`,
   `IngestionSupervisor`.
5. `SIGINT` / `SIGTERM`: close the socket, flush snapshots, disconnect
   Redis, close the BullMQ worker, exit 0.

The order pipeline and the price pipeline share a process but do not
share control flow. A stuck WebSocket does not stop order execution,
and a slow order does not stop tick handling. They can still contend
for Postgres and Redis.

### Order execution

`startOrderProcessor` (`order-processor.ts`):

- Builds a BullMQ `Queue` and `Worker` on `orders`, plus a `Queue` on
  `orders-dead-letter`.
- Calls `setGlobalConcurrency(1)` on the queue. BullMQ open source has
  no per-user groups (that is a Pro feature). Global concurrency 1 is
  stricter than "one at a time per user": orders for different users
  also wait. The worker is also constructed with `concurrency: 1`.
  Do not raise either without a new per-user sequencing mechanism.
  The Postgres row lock is the correctness backstop if concurrency is
  ever raised; it is not a license to raise it.
- Immediately reconciles, then every 30 seconds.
- On `completed`, logs the order id.
- On `failed`: if attempts remain, warn and let BullMQ retry. If
  `attemptsMade >= attempts` (5), log an alert and add a dead-letter
  job with `jobId = orderId`. A dead-letter write failure is logged
  and not retried by this handler.
- Business rejections (no cash, no shares, no price) do not throw.
  They commit `REJECTED` and the job completes. The dead-letter queue
  is for unexpected failures (database down, user row missing), not
  for "you cannot afford this".

`reconcilePendingOrders` loads every `PENDING` order and `queue.add`s
it with the same options the API used. If the job already exists,
BullMQ rejects the add, the error is logged, and the loop continues.
That is how a crash between the API's insert and its enqueue, or a
Redis outage, gets repaired without double execution.

`executeOrder` (`execute-order.ts`) is the ledger. One
`prisma.$transaction` (Prisma's default interactive transaction,
Read Committed in Postgres):

1. Raw SQL, the only raw SQL in the project:
   `SELECT id FROM users WHERE id = ${userId} FOR UPDATE`.
   Prisma has no row-lock API. The lock is held until commit or
   rollback. A second transaction for the same user blocks here.
   The parameterized `Prisma.sql` tag is what keeps this injection-safe.
   Zero rows → throw (job retries).
2. Load the order. Missing, or `order.userId !== job.userId` → throw.
3. If status is not `PENDING`:
   - `eventPublishedAt` already set → return null. The caller publishes
     nothing. This is the idempotent replay.
   - `eventPublishedAt` null → rebuild the event from the committed row
     and fall through to publish. The trade is not applied again.
     A filled order with a null fill price throws.
4. Latest `PriceSnapshot` for `order.symbol`. None → set
   `REJECTED` / `PRICE_UNAVAILABLE` / `processedAt = now`, return a
   rejection event.
5. `tradeValue = snapshot.priceCents * BigInt(quantity)`.

Buy:

- Read cash. If `cash < tradeValue` → `INSUFFICIENT_FUNDS`. No balance
  or holding write.
- New basis = old basis (or 0) + `tradeValue`. New quantity = old +
  order quantity. Display average = new basis / new quantity.
- Decrement cash by `tradeValue`.
- Upsert the holding. The create path sets `avgCostCents` to the fill
  price (exact, because the basis is `price * quantity`) and
  `costBasisCents` to `tradeValue`.

Sell:

- No holding, or `holding.quantity < order.quantity` →
  `INSUFFICIENT_SHARES`.
- Sold basis = `(costBasis * sellQty) / heldQty` (integer division).
  Remaining basis = old basis − sold basis (the truncated remainder
  stays with the unsold shares).
- Remaining quantity 0 → average 0 and remaining basis, which is 0 when
  the full position is sold because the division is exact.
- Increment cash by `tradeValue` (the sale proceeds, not the basis).
- Update the holding in place. The row is not deleted.

Then, still inside the transaction: status `FILLED`, `fillPriceCents`,
`rejectionReason = null`, `processedAt`, and a ledger row
`TRADE_BUY` (negative) or `TRADE_SELL` (positive) linked to the order.

After the transaction commits, if there is an event:

1. `PUBLISH order.events` with `JSON.stringify(event)`. `fillPriceCents`
   is a string.
2. `updateMany` where `id` and `eventPublishedAt IS NULL`, set
   `eventPublishedAt = now`.

If publish throws, `eventPublishedAt` stays null, BullMQ retries, step 3
republishes, and the cash movement is not repeated. Delivery is
at-least-once. A future WebSocket gateway must tolerate duplicate events.
If the publish succeeds and the process dies before `eventPublishedAt`
is set, the retry publishes a second copy. That is accepted.

The concurrency test (`concurrency.spec.ts`) does not go through BullMQ.
It calls `executeOrder` via `Promise.all` against real Postgres, which
is the row-lock proof:

- 10 buys and 10 sells of 1 share, price ₹10, starting cash ₹10,000 and
  100 shares. All 20 fill. Cash and quantity return to the start. 20
  ledger rows. Repeated 3 times in one test.
- 20 parallel buys of ₹10 with only ₹100 cash. Exactly 10 fill, 10
  reject, cash ends at 0, quantity ends at 10.
- 20 parallel sells of a 10-share position. Exactly 10 fill, 10 reject,
  quantity ends at 0, cash ends at the sale proceeds.

`execute-order.spec.ts` covers insufficient funds, missing price,
insufficient shares, replay of an already-published order (no second
ledger row), republish of an unpublished fill, a buy's weighted average,
and exact basis when the average does not divide evenly.

### Price ingestion

Normal path, market open: one persistent Upstox Market Data Feed V3
WebSocket, subscribed in `ltpc` mode (last traded price, quantity, and
time — not full depth) to all 100 instrument keys.

`IngestionSupervisor.run` loops until shutdown.

1. Ask `UpstoxMarketCalendar.currentSession(now)`.
   - Weekend in `Asia/Kolkata` (Saturday or Sunday) → closed, no HTTP call.
   - Otherwise `GET https://api.upstox.com/v2/market/timings/{YYYY-MM-DD}`
     with the analytics token. The date is the Indian calendar date.
     The result is cached for that date. An NSE entry's `start_time` /
     `end_time` (epoch milliseconds) is the session. No NSE entry means
     a holiday or a closed day. A failed request throws; the supervisor
     logs, waits 60 seconds, and tries again. It does not guess that the
     market is open.
2. If now is outside the session:
   - Reset the WebSocket failure counter.
   - If a closing snapshot has not yet succeeded for this closed period,
     call the REST LTP fallback once (100 keys, one request) and push
     each result through `TickHandler`. Success sets a flag so the next
     60-second polls do not call Upstox again. Failure leaves the flag
     clear and retries next poll.
   - The LTP response has no trade timestamp. The tick's `ts` is the
     fetch time.
   - Wait 60 seconds and continue. The WebSocket stays down.
3. If inside the session, clear the closed-snapshot flag (so the next
   close takes a fresh snapshot). Open the socket. A timer fires at
   `session.end` and disconnects, which is a clean session end, not a
   failure.
4. On each binary message, ticks are decoded and handled on a single
   promise chain (`this.processing = this.processing.then(...)`). A slow
   tick delays the next one; it does not run beside it.
5. Unexpected disconnect or connect failure increments `failures`.
   Backoff is `min(1000 * 2^(failures-1), 30000)` milliseconds: 1s, 2s,
   4s, 8s, 16s, then 30s.
6. At 5 failures, log an alert and switch to the REST LTP fallback on a
   30-second poll until the socket connects again or the session ends.
   A clean session end resets the failure count and does not count as
   a fallback trigger.

`UpstoxClient.connect`:

1. `GET https://api.upstox.com/v3/feed/market-data-feed/authorize` with
   `Authorization: Bearer {analytics token}`.
2. Read `data.authorized_redirect_uri`. It must be `wss:`, or `ws:` only
   when the host is localhost / 127.0.0.1 (tests). The URL is one-use
   and is not stored.
3. Open the socket. On `open`, send a JSON text frame buffered as binary:

   ```json
   { "guid": "<uuid>", "method": "sub", "data": { "mode": "ltpc", "instrumentKeys": [ "...100 keys" ] } }
   ```

4. `message` events are normalized to a single `Buffer` and handed to
   the decoder. `error` / `close` call `onClose` unless this side
   already called `close()`.

`TickDecoder` embeds the official V3 protobuf schema as a string
(`MARKET_DATA_PROTO`) and parses it with `protobufjs`. `decode`:

- Decode a `FeedResponse`.
- Walk `feeds`, a map of instrument key → feed.
- Last price (`ltp`) is taken from `feed.ltpc`, or
  `feed.fullFeed.marketFF.ltpc`, or `feed.firstLevelWithGreeks.ltpc`.
  Non-positive or missing `ltp` is skipped.
- Timestamp is `ltpc.ltt` when it is a non-zero digit string, otherwise
  `currentTs` on the envelope. A missing timestamp skips the tick.
- Output is `{ instrumentKey, priceRupees: number, timestampMilliseconds: string }`.
  `priceRupees` is still the provider double at this point.

`TickHandler.handle`:

1. Map `instrumentKey` through `INSTRUMENT_BY_KEY`. An unknown key throws
   (the supervisor logs it and continues the chain).
2. `wireRupeesToPaise(priceRupees)`.
3. `SET price:{tradingSymbol}` and `PUBLISH price.ticks` with the string
   JSON. These two happen before the function returns; they are the
   low-latency path.
4. `SnapshotFlusher.retain(tick)` replaces the buffered tick for that
   symbol. The buffer never holds more than one tick per symbol.

`SnapshotFlusher` every 5 seconds (and once more on shutdown):

- Copy the map values and `priceSnapshot.createMany`.
- Delete a buffered entry only if the map still holds the same object.
  A tick that arrived during the insert stays buffered for the next
  flush. A failed flush logs an alert and leaves the buffer intact, so
  the next interval retries those ticks (and may insert a duplicate
  snapshot if a later attempt succeeds after a commit that the client
  thought failed — snapshots are an append-only history, so a duplicate
  timestamped row is stale-but-safe, and "latest by `ts`" still works).

`UpstoxRestFallback.fetchTicks` calls
`GET https://api.upstox.com/v3/market-quote/ltp?instrument_key={comma-separated keys}`.
It keeps records with a positive `last_price` and stamps them with
`Date.now()`. Those decoded prices go through `TickHandler`, so a REST
snapshot updates Redis, pub/sub, and eventually Postgres the same way a
socket tick does.

The analytics token is a one-year read-only Upstox token from the
environment. There is no API key/secret pair, no TOTP, and no daily
login job. That earlier design is recorded as superseded in
`docs/DECISIONS.md`.

## Frontend

`apps/web` is a Vite + React 19 SPA (React Router 7, TanStack Query 5,
`@auth0/auth0-react`). It does not import Prisma or talk to Redis or
Upstox. It implements one interface, `TradeSimApi`, twice: `createHttpApi`
for live mode and `createMockApi` for demo mode.

### Boot and routing

`index.html` loads Fraunces, Public Sans, and IBM Plex Mono, and applies
`localStorage["tradesim.theme"]` before first paint so the theme does not
flash. `main.tsx` mounts `App` inside `BrowserRouter` and `StrictMode`.

`App` nests, from the outside: `QueryClientProvider` → auth provider →
`ApiProvider` → `ToastProvider` → routes.

| Path | Page | Gate |
|---|---|---|
| `/` | `LandingPage` | Public. Login and sign-up buttons. |
| `/app` | `MarketPage` | `RequireAuth` then `RequireAccount` then `AppShell`. |
| `/app/stocks/:symbol` | `StockPage` | Same shell. |
| `/app/portfolio` | `PortfolioPage` | Same shell. |
| `/app/orders` | `OrdersPage` | Same shell. |
| `/app/profile` | `ProfilePage` | Same shell. |
| anything else | `NotFoundPage` | Public. |

`readConfig` (`config.ts`): `VITE_API_MODE=mock` selects mock. Any other
value, including unset, selects live. Live mode needs
`VITE_AUTH0_DOMAIN`, `VITE_AUTH0_CLIENT_ID`, and `VITE_AUTH0_AUDIENCE`.
If any are missing, the tree renders `AuthConfigMissing` instead of an
auth provider. `VITE_API_BASE_URL` defaults to `/api` with a trailing
slash removed. `PRICE_REFRESH_MS` is 5 seconds. `PORTFOLIO_REFRESH_MS`
is 10 seconds.

The audience must be the custom API identifier (the project uses
`https://tradesim-api`), the same value as the API's `AUTH0_AUDIENCE`.
The Auth0 Management API audience is the wrong value; Auth0 responds
"Service not found".

`Auth0AuthProvider` requests that audience, redirect URI
`{origin}/app`, refresh-token rotation, and `localstorage` cache. After
redirect it navigates to `appState.returnTo` or `/app`. `Auth0Bridge`
adapts the Auth0 SDK into the app's `AuthState` so the rest of the UI
never imports `@auth0/auth0-react`. `getAccessToken` calls
`getAccessTokenSilently`.

`MockAuthProvider` stores `tradesim.mock-signed-in` in `localStorage`
and signs in as `auth0|demo-trader` ("Demo Trader") with token
`"mock-token"`. No network.

`RequireAuth`: while Auth0 is loading, or while a redirect is in flight,
show a full-page loader. On auth error, show the message and a retry.
If signed out, call `login({ returnTo: current path })`.

`RequireAccount` runs `useAccount()`, which is `POST /me` (or the mock),
cached forever for that `sub` (`staleTime: Infinity`, no refetch on
focus). `created: true` shows one welcome toast with the starting cash.
Errors render `AccountProblem`:

- `EMAIL_IN_USE` — log out and switch method. No retry.
- `EMAIL_MISSING` — log out. No retry.
- `EMAIL_NOT_VERIFIED` — "I've verified my email" refetches.
- Anything else — generic retry plus log out.

Only after that does `AppShell` render: sidebar (Market, Portfolio,
Orders, Profile, and the last stock viewed in this session), top bar
search, a "Live · 5s" or "Demo feed" pill, a cash pill from the
portfolio query, and the avatar.

Query defaults: retry up to 2 times, but never retry an `ApiError` in
the 400 range; refetch on window focus; `staleTime` 2 seconds.
Mutations are not retried.

### What the screens do

`LandingPage` — marketing page. Sign-up uses Auth0 `screen_hint: "signup"`.
A scrolling ticker shows the first 40 catalog names. Authenticated
visitors get "Open dashboard" instead of the login buttons.

`MarketPage` — `GET /stocks` with a 20-row page. The search box is
debounced (the page's own input, plus URL `?q=`). Each visible row also
polls `GET /stocks/:symbol` every 5 seconds via `useStockPrices`. The
"session change" column is not a day change. It is the difference
between the first and last price this browser tab has observed, kept in
memory by `recordPrice`. Empty history renders an em dash. Rows link to
`/app/stocks/{symbol}`.

`SearchBox` (top bar) — debounced 180ms, `GET /stocks` limited to 8
results, only while the box is open and non-empty. `/` focuses it when
you are not already typing. Arrow keys move, Enter navigates.

`StockPage` — if the symbol is not in `INSTRUMENT_BY_SYMBOL`, the page
says it is outside the 100. Otherwise: name, ISIN, instrument key, last
price with a green/red flash when the polled value changes, session
high/low/change from the in-memory series, an SVG `PriceChart`, and
`OrderTicket`. Chart Y positions are the only `Number()` conversion of
a price: `((paise - low) * 10000n) / range` then divide by 10000. A
flat series sits at the midline.

`OrderTicket` — Buy/Sell toggle, quantity presets 1/5/10/25, free text.
`parseQuantity` mirrors the API: whole number, 1 to 1,000,000. Client-side
blockers (not a substitute for the worker): no price yet, estimated cost
above known cash, sell quantity above known shares. Submit calls
`POST /orders` and treats 202 as "queued". The toast says the order will
execute at the next confirmed price. On success, `logOrder` writes the
202 body plus the estimated price into `localStorage` under
`tradesim.orders.{auth0 sub}`, capped at 100, newest first. The portfolio
query is invalidated at 1.5s, 4s, and 9s to catch the worker. The ticket
does not learn the final fill.

`PortfolioPage` — four tiles (total value, invested cost basis, unrealized
P&L and percent of basis, cash) and a table sorted by market value.
Allocation bar widths are P&L-style percents of holdings value. Zero
holdings shows an empty state. P&L percent is basis points
(`numerator * 10000n / denominator`) truncated to two decimals, not
rounded, and is null when the denominator is 0.

`OrdersPage` — reads that localStorage log. Status labels: PENDING →
"Queued", FILLED → "Filled", REJECTED → "Rejected". Live submissions
stay "Queued" because the stored status is the 202 body and nothing
updates it later. "Clear list" deletes the key. The notice on the page
says this is a stand-in until `GET /orders` exists.

`ProfilePage` — Auth0 name, email, picture; cash and portfolio value from
`GET /portfolio`; account email, member-since, and the constant starting
capital from `POST /me`; email-verified and the raw `sub`; theme
segmented control (`system` / `light` / `dark`, stored as
`tradesim.theme`, `system` deletes the key); data-source hint; log out.

`NotFoundPage` — links home and to `/app`.

### Mock API

`createMockApi` keeps cash, holdings, and prices in closure state.
Starting cash is the same ₹1,00,000. With `seedHoldings` (default true)
it opens positions in RELIANCE, TCS, INFY, and HDFCBANK, sized from a
hash of the symbol, and subtracts their basis from cash. Prices are a
deterministic base (₹150.00 to ₹4,999.95, 5-paise ticks) plus a random
walk of at most ±0.20% when a symbol is read and at least 2 seconds have
passed. Search filters the same catalog the API uses. `createOrder`
returns `PENDING` immediately and, after 1.2 seconds, applies the same
BigInt buy/sell basis rules as the worker, silently no-op'ing a buy
without cash or a sell without shares (it does not surface a rejection
on the order object). `ensureAccount` returns `created: true` only on
the first call in that page lifetime.

### Browser money helpers

`apps/web/src/lib/money.ts` — `parsePaise` (rejects anything except an
optional minus and digits), `formatRupees` (₹ prefix, Indian grouping:
`12,34,567.00`, optional sign), `formatPercent`, `direction`,
`parseQuantity`, `orderValue`. Grouping and the rupee sign are UI-only;
`paiseToDisplayRupees` stays ungrouped so the API and tests share a
stable string.

## Environment

Root `.env` (from `.env.example`), loaded for API, worker, and Prisma:

| Variable | Used by |
|---|---|
| `DATABASE_URL` | Prisma. Local default `postgresql://tradesim:tradesim@localhost:5432/tradesim`. |
| `REDIS_URL` | API `RedisService`, API BullMQ, worker BullMQ, worker ingestion. |
| `AUTH0_DOMAIN` | JWT issuer and the `/userinfo` host. |
| `AUTH0_AUDIENCE` | JWT audience check. |
| `UPSTOX_ANALYTICS_TOKEN` | Worker only. Authorize, market timings, and LTP. |
| `PORT` | API listen port, default 3000. |

`apps/web/.env.local` (from `apps/web/.env.example`): `VITE_API_MODE`,
`VITE_API_BASE_URL`, `VITE_AUTH0_DOMAIN`, `VITE_AUTH0_CLIENT_ID`,
`VITE_AUTH0_AUDIENCE`. Optional `VITE_DEV_API_TARGET` overrides the Vite
proxy target (default `http://localhost:3000`). `.gitignore` ignores
`.env` and `.env.*` except `.env.example`. Do not put real tokens in
example files.

Docker Compose (`docker-compose.yml`): Postgres 16 Alpine with user,
password, and database all `tradesim`, a named volume `pgdata`; Redis 7
Alpine with volume `redisdata`; Adminer on 8080 depending on Postgres.
No app containers. API, worker, and web run on the host via pnpm.

## Commands

From the repo root, with pnpm 9:

| Script | Effect |
|---|---|
| `pnpm install` | Workspace install. |
| `pnpm db:generate` | `prisma generate`. |
| `pnpm db:migrate` | `prisma migrate dev`. |
| `pnpm db:seed` | `tsx prisma/seed.ts`. |
| `pnpm db:studio` | Prisma Studio. |
| `pnpm dev:api` | Build libs, load `.env`, `nest start --watch`. |
| `pnpm dev:worker` | Build libs, load `.env`, `tsx watch` the worker. |
| `pnpm dev:web` | Vite. Does not build the libs; it compiles common from source. |
| `pnpm build` | Recursive production build, one package at a time. |
| `pnpm lint` | ESLint, one package at a time. |
| `pnpm test` | Package tests, one package at a time. API and worker Jest use `--runInBand`. |
| `pnpm test:concurrency` | Worker's real-Postgres concurrency file only. Needs `.env` and a migrated database. |

`nest start --watch` is required for the API. `tsx` does not emit the
decorator metadata Nest uses to inject constructors, so `ConfigService`
would arrive as `undefined`. The worker is not a Nest app and can use
`tsx`.

TypeScript is strict (`tsconfig.base.json`): ES2022, CommonJS for the
Node packages, decorators and decorator metadata on, `noUnusedLocals`.
`eslint.config.mjs` uses `typescript-eslint` recommended and warns
(does not error) on explicit `any`, because Prisma's generated types
use it.

## File by file

### Repository root

| File | Role |
|---|---|
| `package.json` | Root scripts above. Dev dependencies: TypeScript, tsx, ESLint, Prettier, dotenv-cli. |
| `pnpm-workspace.yaml` | Workspace globs `apps/*` and `libs/*`. |
| `pnpm-lock.yaml` | Lockfile. |
| `tsconfig.base.json` | Shared compiler options and path aliases for `@tradesim/db` and `@tradesim/common`. |
| `eslint.config.mjs` | Root ESLint flat config. |
| `docker-compose.yml` | Postgres, Redis, Adminer. |
| `.env.example` | Backend env template. |
| `.gitignore` | Ignores `node_modules`, `dist`, `.env`, coverage, and a leftover root `nse_top_100.json` (the catalog now lives under `libs/common`). |
| `AGENTS.md` | Canonical context for AI agents. Status summary. Points at `docs/TASKS.md` for what to build next. |
| `CLAUDE.md` | Pointer at `AGENTS.md`, plus "run lint and test before finishing". |
| `.cursor/rules/project.mdc` | Same workflow, always loaded in Cursor. |
| `.github/copilot-instructions.md` | Pointer at `AGENTS.md`. |
| `docs/ARCHITECTURE.md` | Diagrams and the correctness rules. Some sentences still describe folders as future work; the tree in this guide matches the code. |
| `docs/DECISIONS.md` | Lightweight ADRs: Postgres, Nest, BullMQ, Upstox, string paise, global queue concurrency, reconciliation, analytics token, provider market hours, the SPA, one-email accounts. |
| `docs/TASKS.md` | Phase checklist. Source of truth for what is done. |
| `docs/CODEBASE.md` | This guide. |

### `libs/common`

| File | Role |
|---|---|
| `package.json` | Name `@tradesim/common`. `main` is `dist/index.js`. |
| `tsconfig.json` | Compiles `src` to `dist`. `resolveJsonModule` so the catalog JSON imports. |
| `jest.config.cjs` | Jest via ts-jest. |
| `src/index.ts` | Money helpers, queue/channel names, `PriceTick`, `OrderJobData`, `OrderExecutionEvent`. |
| `src/money.spec.ts` | Display formatting, string parsing, and wire-rupee rounding, including half-up. |
| `src/instrument-catalog.ts` | Validates and indexes the 100 equities. |
| `src/instrument-catalog.spec.ts` | Asserts count, uniqueness, key format, and a few known symbols. |
| `src/data/nse-top-100.json` | The universe. Versioned. Do not edit casually; the loader fails the process on shape or duplicate errors. |

### `libs/db`

| File | Role |
|---|---|
| `package.json` | `@tradesim/db`. Depends on `@prisma/client`. Prisma seed command is `tsx prisma/seed.ts`. |
| `tsconfig.json` | Compiles `src/index.ts` only. The schema is not compiled by tsc. |
| `src/index.ts` | Singleton `prisma` plus `export * from "@prisma/client"`. |
| `prisma/schema.prisma` | The five models and two enums. |
| `prisma/seed.ts` | Two users and three fake prices. Upsert by email with empty `update`. |
| `prisma/migrations/migration_lock.toml` | Provider lock. |
| `prisma/migrations/20260905190945_init/migration.sql` | Initial schema. |
| `prisma/migrations/20260913141000_order_event_delivery/migration.sql` | Event-delivery columns and CHECKs. |
| `prisma/migrations/20260913143000_exact_holding_cost_basis/migration.sql` | Exact basis column and backfill. |

No tests. The package script prints "(no tests yet for @tradesim/db)".

### `apps/api`

| File | Role |
|---|---|
| `package.json` | Nest 10, Passport JWT, JWKS, BullMQ, ioredis, class-validator. `pretest` builds the two libs. |
| `nest-cli.json` | Nest compiler, `sourceRoot: src`, deletes `dist` on build. |
| `tsconfig.json` | Extends the base. Nest build settings. |
| `jest.config.cjs` | ts-jest, run from `src`. |
| `src/main.ts` | `NestFactory`, global `ValidationPipe`, listen on `PORT`. |
| `src/app.module.ts` | Imports config (global), Prisma, Redis, auth, accounts, market, portfolio, orders. Registers `JwtAuthGuard` as `APP_GUARD`. Declares `HealthController`. |
| `src/health/health.controller.ts` | `GET /health`, `@Public()`, user count. |
| `src/health/health.controller.spec.ts` | Mocks Prisma, expects `{ status: "ok", userCount: 2 }`. |
| `src/prisma/prisma.module.ts` | `@Global()` provider. |
| `src/prisma/prisma.service.ts` | `PrismaClient` subclass. `$disconnect` on module destroy. |
| `src/redis/redis.module.ts` | `@Global()` provider. |
| `src/redis/redis.service.ts` | ioredis subclass. `lazyConnect`, 2 retries per request. Throws at construction if `REDIS_URL` is missing. `disconnect` on destroy. |
| `src/auth/auth.module.ts` | `@Global()` Passport module, default strategy `jwt`. |
| `src/auth/jwt.strategy.ts` | JWKS RS256 strategy. `validate` returns the payload unchanged. |
| `src/auth/jwt-auth.guard.ts` | Skips the strategy when `@Public()` is set on the handler or the class. |
| `src/auth/public.decorator.ts` | `SetMetadata("isPublic", true)`. |
| `src/auth/auth.integration.spec.ts` | Boots the app. Unsigned request to a protected route is 401. A locally signed RS256 token with the right issuer and audience is 200. JWKS is mocked so CI does not call Auth0. `/health` stays open. |
| `src/accounts/accounts.module.ts` | Controller plus the two providers. |
| `src/accounts/accounts.controller.ts` | `POST /me`. Sets 201 vs 200 with `@Res({ passthrough: true })`. |
| `src/accounts/accounts.service.ts` | The ensure-account flow, email conflict, unique-violation race. |
| `src/accounts/auth0-user-info.service.ts` | `GET /userinfo` and the status mapping. |
| `src/accounts/dto/account-response.dto.ts` | String paise, ISO `createdAt`, `created` boolean. |
| `src/accounts/accounts.service.spec.ts` | Existing account skips userinfo; exact opening balance and deposit; both conflict directions; unverified and missing email; `sub` mismatch; both race outcomes; provider labels. |
| `src/accounts/auth0-user-info.service.spec.ts` | HTTP error mapping and email normalization. |
| `src/accounts/accounts.controller.spec.ts` | 201, 200, and 401 when the header is not Bearer. |
| `src/accounts/accounts.integration.spec.ts` | Real Postgres. Eight concurrent first logins create exactly one user and one deposit. A second identity with the same email gets 409. |
| `src/market/market.module.ts` | Exports `MarketService` for the portfolio module. |
| `src/market/market.controller.ts` | `/indices`, `/stocks`, `/stocks/:symbol`. |
| `src/market/market.service.ts` | Cache-aside read and in-memory catalog search. |
| `src/market/dto/market-price-response.dto.ts` | String `priceCents`. |
| `src/market/dto/stock-catalog-query.dto.ts` | Validated `query`, `page`, `limit`. |
| `src/market/dto/stock-catalog-response.dto.ts` | Item DTO (drops segment and instrument type) and page DTO with `totalPages`. |
| `src/market/market.service.spec.ts` | Cache hit, malformed cache, Redis down, DB fallback, empty indices, search and pagination. |
| `src/market/market.integration.spec.ts` | Real Postgres and Redis. Cache hit does not need a new snapshot read; cache miss reads the seeded snapshot and repopulates Redis. |
| `src/portfolio/portfolio.module.ts` | Imports `MarketModule`. |
| `src/portfolio/portfolio.controller.ts` | `GET /portfolio` using `request.user.sub`. |
| `src/portfolio/portfolio.service.ts` | BigInt valuation. |
| `src/portfolio/dto/portfolio-response.dto.ts` | String money fields. |
| `src/portfolio/portfolio.service.spec.ts` | No holdings; several buys (weighted basis); fully sold position omitted; missing price; missing user. |
| `src/portfolio/dto/portfolio-response.dto.spec.ts` | BigInt values leave the DTO as decimal strings. |
| `src/orders/orders.module.ts` | BullMQ root connection and the `orders` queue. |
| `src/orders/orders.controller.ts` | `POST /orders`, `@HttpCode(202)`. |
| `src/orders/orders.service.ts` | Insert then best-effort enqueue. |
| `src/orders/dto/create-order.dto.ts` | class-validator input. |
| `src/orders/dto/order-response.dto.ts` | 202 body. No fill price. |
| `src/orders/dto/create-order.dto.spec.ts` | Accepts and rejects symbol, side, and quantity. |
| `src/orders/orders.service.spec.ts` | Creates a PENDING row, enqueues with `jobId = order.id`, still returns the order when enqueue throws, 404 when the user does not exist. |

Not present, and named in `docs/TASKS.md` as later phases: `src/realtime/`,
`src/ai/`.

### `apps/worker`

| File | Role |
|---|---|
| `package.json` | BullMQ, ioredis, `ws`, protobufjs. No Nest. `test:concurrency` targets one file. |
| `tsconfig.json` | Compiles to `dist` for `node dist/index.js`. Dev uses tsx and does not need that build. |
| `jest.config.cjs` | ts-jest. |
| `src/index.ts` | Process entry. Starts both pipelines and handles signals. |
| `src/execution/order-processor.ts` | Queue, worker, global concurrency, reconciliation, dead letter. |
| `src/execution/order-processor.spec.ts` | Reconciliation enqueues pending rows and tolerates an add failure. |
| `src/execution/execute-order.ts` | The transaction, row lock, fills, rejections, post-commit publish. |
| `src/execution/execute-order.spec.ts` | Rejection paths, idempotency, republish, exact basis. |
| `src/execution/concurrency.spec.ts` | Real-Postgres parallel `executeOrder`. The most important test in the repo. |
| `src/ingestion/ingestion-supervisor.ts` | Session loop, backoff, fallback, closed-market snapshot. |
| `src/ingestion/ingestion-supervisor.spec.ts` | Fake clock and fake socket. Backoff then REST fallback. One LTP batch per closed period, retry on failure, a new batch after a session. |
| `src/ingestion/market-hours.ts` | Weekend shortcut, Upstox timings, per-date cache. |
| `src/ingestion/market-hours.spec.ts` | Weekend, holiday (no NSE), open session, failed HTTP, cache. |
| `src/ingestion/upstox-client.ts` | Authorize, socket, LTPC subscribe, token shape check. |
| `src/ingestion/upstox-client.spec.ts` | Mock HTTP and a local `ws` server. Rejects non-wss URLs. Subscribes after open. |
| `src/ingestion/tick-decoder.ts` | Embedded protobuf and LTPC extraction. |
| `src/ingestion/tick-decoder.spec.ts` | Encodes a fixture `FeedResponse` and checks decoded ticks, including skips. |
| `src/ingestion/tick-handler.ts` | Key → symbol, paise rounding, Redis set + publish, buffer retain. |
| `src/ingestion/tick-handler.spec.ts` | Cache payload, channel, unknown key, bad timestamp. |
| `src/ingestion/snapshot-flusher.ts` | 5-second `createMany`, reference-safe buffer delete. |
| `src/ingestion/snapshot-flusher.spec.ts` | Dedupes to the latest tick, keeps a tick that arrives mid-flush. |
| `src/ingestion/upstox-rest-fallback.ts` | Batched LTP GET. |
| `src/ingestion/upstox-rest-fallback.spec.ts` | Parses a success body, rejects a bad one, stamps fetch time. |

### `apps/web`

| File | Role |
|---|---|
| `package.json` | Vite, React 19, React Router, TanStack Query, Auth0 SPA SDK. Tests are Vitest. |
| `tsconfig.json` | Bundler resolution, JSX, includes Vite client types. |
| `vite.config.ts` | React plugin, `@tradesim/common` alias to source, dev proxy `/api` → 3000 with prefix stripped, manual chunk groups, Vitest jsdom. |
| `eslint.config.mjs` | Web-specific lint, including react-hooks. |
| `index.html` | Fonts, theme boot script, `#root`. |
| `.env.example` | Frontend env template. |
| `public/favicon.svg` | Icon. |
| `src/vite-env.d.ts` | `ImportMetaEnv` fields for the `VITE_*` variables. |
| `src/main.tsx` | React root and browser router. |
| `src/App.tsx` | Providers, query client, route table. |
| `src/config.ts` | Mode, Auth0 config, poll intervals. |
| `src/config.test.ts` | Mock vs live, missing variables, URL cleanup. |
| `src/styles/global.css` | The whole visual system: dark ledger palette, light theme via `[data-theme]`, layout, tables, ticket, landing page. There is no CSS-in-JS and no component library. |
| `src/api/types.ts` | Wire types and `TradeSimApi`. `ApiError` carries HTTP status and optional `code`. |
| `src/api/http-api.ts` | `fetch` client. Attaches the bearer token. 404 on `getStock` becomes `null`. Other errors become `ApiError`. |
| `src/api/http-api.test.ts` | Token header, error-body parsing, 404 mapping, network failure. |
| `src/api/mock-api.ts` | In-browser broker with the worker's basis rules. |
| `src/api/mock-api.test.ts` | Search, random walk, buy/sell settlement, insufficient cash/shares. |
| `src/api/api-context.tsx` | Picks mock, HTTP, or a test double. |
| `src/api/queries.ts` | React Query hooks: account, search, prices, portfolio, place-order. |
| `src/auth/auth-context.ts` | `AuthState`, `useAuth`, `initials`. |
| `src/auth/Auth0AuthProvider.tsx` | Auth0 SDK wired to that context. |
| `src/auth/MockAuthProvider.tsx` | localStorage demo sign-in. |
| `src/components/AppShell.tsx` | `RequireAuth`, `RequireAccount`, sidebar and top bar. |
| `src/components/AppShell.test.tsx` | Welcome toast once, blocking screens for the three account error codes. |
| `src/components/StatusScreens.tsx` | Loaders, auth-config message, notices, account problem, query error, missing profile. |
| `src/components/OrderTicket.tsx` | Buy/sell form. |
| `src/components/OrderTicket.test.tsx` | Validation, cash and share blockers, successful submit. |
| `src/components/PriceChart.tsx` | SVG line and area from session points. |
| `src/components/SearchBox.tsx` | Top-bar typeahead. |
| `src/components/Pager.tsx` | Previous / next and a page label. |
| `src/components/toast.tsx` | Small toast stack. `useToast()`. |
| `src/components/Icons.tsx` | Inline SVGs. No icon font. |
| `src/pages/LandingPage.tsx` | Public marketing page. |
| `src/pages/MarketPage.tsx` | Catalog table and polled prices. |
| `src/pages/StockPage.tsx` | Detail, chart, ticket. |
| `src/pages/PortfolioPage.tsx` | Totals, allocation, holdings. |
| `src/pages/PortfolioPage.test.tsx` | Renders BigInt totals, P&L, and the empty state. |
| `src/pages/OrdersPage.tsx` | localStorage order log. |
| `src/pages/ProfilePage.tsx` | Identity, account facts, theme, logout. |
| `src/pages/NotFoundPage.tsx` | Unknown URL. |
| `src/lib/money.ts` | Parse, format, percent, quantity. |
| `src/lib/money.test.ts` | Those helpers, including Indian grouping. |
| `src/lib/catalog.ts` | `findInstrument`, `displayName` (short name, else title-cased legal name), `monogram`. |
| `src/lib/price-history.ts` | In-memory series, max 360 points, `sessionStats`. |
| `src/lib/order-log.ts` | Per-subject localStorage order list. |
| `src/lib/theme.ts` | `system` / `light` / `dark`. |
| `src/lib/time.ts` | IST formatters and a coarse "Ns ago". |
| `src/lib/use-debounced.ts` | `useDebounced` and `useNow`. |
| `src/test/setup.ts` | Testing Library jest-dom matchers. |
| `src/test/render.tsx` | `renderWithProviders`: memory router, query client, fake auth, fake API. |

### `infra/auth0`

| File | Role |
|---|---|
| `pre-user-registration-block-duplicate-email.js` | Auth0 Action source. Not executed by this repo. Header comments are the install steps: M2M app with only `read:users`, secrets `DOMAIN`, `CLIENT_ID`, `CLIENT_SECRET`, attach to the Pre User Registration trigger. |

## End-to-end walks

### Sign in and open an account

1. Browser loads `/app`. `RequireAuth` sees no session and redirects to Auth0.
2. Auth0 redirects back to `http://localhost:5173/app` with a code. The SDK
   stores tokens and navigates to `/app`.
3. `useAccount` sends `POST /api/me`. Vite forwards `POST /me` with the
   bearer token.
4. The guard validates the JWT against JWKS.
5. First visit: `/userinfo`, then the insert of user + deposit, 201.
   Later visits: the `auth0Id` lookup, 200, no Auth0 call.
6. The shell renders. Portfolio and market queries start.

### A price reaching the screen

1. Worker calendar says NSE is open (or, if closed, one LTP batch already ran).
2. A protobuf frame arrives. Decoder pulls `ltp` and a timestamp.
3. Handler converts rupees to paise, `SET`s `price:RELIANCE`, publishes
   `price.ticks`, and keeps the tick in the flush buffer.
4. Within 5 seconds, `createMany` appends a `price_snapshots` row.
5. The stock page's query fires every 5 seconds. `GET /stocks/RELIANCE`
   reads Redis first and returns string paise.
6. The page parses to `bigint`, formats ₹, appends a chart point if `ts`
   changed, and flashes the price if the value changed.

If Redis is empty (flushed, or the API booted before any tick), step 5
reads the latest snapshot and refills the cache. If neither exists, the
page shows "No price".

### A buy

1. Ticket submits `{ symbol: "RELIANCE", side: "BUY", quantity: 2 }`.
2. API validates, inserts `orders` as `PENDING`, enqueues job id = order id,
   returns 202. Cash is unchanged.
3. The browser stores the 202 in localStorage and refetches the portfolio
   three times over the next 9 seconds.
4. The worker, being the only consumer, picks up the job. It locks the
   user row, sees `PENDING`, reads the latest RELIANCE snapshot, checks
   cash, decrements cash, upserts the holding (basis increases by
   `price * 2`), marks the order filled, inserts `TRADE_BUY`.
5. Commit. Then `PUBLISH order.events`. Then set `eventPublishedAt`.
6. The next portfolio refetch joins the new holding with the current
   price and shows the position. The orders page still says "Queued".

A second buy for the same user cannot run this transaction until the
first commits, because of global queue concurrency and, independently,
`FOR UPDATE`. If the user spends the cash in the first buy, the second
commits `REJECTED` / `INSUFFICIENT_FUNDS` and a rejection event. No
ledger row is written for a rejection.

A sell is the same path with the share check, a cash credit, and a
proportional basis reduction.

## Invariants worth remembering while changing code

- Do not do monetary arithmetic with `number`.
- Do not check or change a balance outside `executeOrder`'s transaction.
- Do not publish `order.events` or treat a fill as done before that
  transaction commits.
- Do not enqueue with a `jobId` other than the order id, and do not
  process an order whose status is already terminal by applying it again.
- Do not raise BullMQ concurrency above 1 without a replacement for
  per-user sequencing. The row lock keeps balances correct; the
  concurrency cap is a separate rule the project chose on purpose.
- Do not call Upstox from the API. Search is local. The token lives on
  the worker.
- Do not write a tick to Postgres one row per message. Buffer to the
  latest tick and let the flusher batch.
- `POST /me` is the only place a `users` row is created. Portfolio and
  orders return 404 until it has run. The web app always calls it before
  showing the shell.

## What is intentionally missing

From `docs/TASKS.md`, still open:

- Phase 6's live gate: during an open NSE session, confirm the API shows
  streamed prices. Authorization, the timings call, and one 100-key LTP
  batch have already been run successfully. Closing prices outside the
  session are implemented.
- A human check of a live buy and sell round-trip.
- Installing the Auth0 Pre User Registration Action, and pointing the
  seeded trader's email at a real address if that protection should
  cover it.
- Phase 7: `apps/api/src/realtime` WebSocket gateway (authenticate the
  handshake, subscribe to `price.ticks` and `order.events`, fan out to
  the right sockets), GitHub Actions CI with Postgres and Redis service
  containers, structured logging, Sentry. The web app would then drop
  the 5-second and 10-second polls.
- `GET /orders` (history, final status, fill price) so the orders page
  can stop using localStorage.
- Price history or previous close, so change and charts are not limited
  to what this tab has polled.
- CORS or a reverse proxy, required for any deployment where the SPA is
  not same-origin with the API.
- Phase 8: an AI portfolio feature, not designed yet.
- Phase 9: deploy API and worker as separate services, managed Postgres
  and Redis, a root README.

Until those exist, a production-shaped local run is: Docker Compose up,
migrate, seed, `pnpm dev:worker`, `pnpm dev:api`, `pnpm dev:web` with
`VITE_API_MODE=live`.
