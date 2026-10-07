# Tasks

Keep this updated — it's what tells the next session (you or an AI agent)
what's actually done vs. still planned. Move items between sections; don't
just append. Work through phases **in order** — later phases are designed to
build on tests already passing in earlier ones. Each phase has a "definition
of done" — don't start the next phase until it's met.

## Phase 0 — Environment
- [x] Monorepo scaffolded and `pnpm install` verified working (5 workspace
  packages: `apps/api`, `apps/worker`, `libs/db`, `libs/common`, root)
- [x] AI tool context wired up: `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/`,
  `.github/copilot-instructions.md` all in repo
- [x] `docker-compose.yml` written (Postgres, Redis, Adminer)
- [x] **You**: run `docker compose up -d` and confirm Postgres/Redis are up
- [x] **You**: open an Upstox account and generate the one-year read-only
  Analytics Token; store it locally as `UPSTOX_ANALYTICS_TOKEN`
- [x] **You**: create root `nse_top_100.json` with the chosen website universe
  (validated: exactly 100 NSE_EQ equities, unique instrument keys and symbols)

## Phase 1 — Data foundation
- [x] Monorepo scaffold: `apps/api`, `apps/worker`, `libs/db`, `libs/common`
- [x] Prisma schema written: `User`, `Holding`, `Order`, `Transaction`,
  `PriceSnapshot`, with all money fields as `BigInt` paise
  (`libs/db/prisma/schema.prisma`)
- [x] Seed script written (`libs/db/prisma/seed.ts`) — 2 test users + 3 fake
  price snapshots for RELIANCE/TCS/INFY
- [x] `apps/api` boots with a `/health` endpoint that queries Postgres via
  Prisma (`apps/api/src/health/health.controller.ts`)
- [x] `apps/worker` placeholder proves DB access works from a second process
  (`apps/worker/src/index.ts`)
- [x] Root `dev:api` / `dev:worker` load `.env` before process start (PrismaClient
  is constructed at import time); shared libraries build first so both
  development and production resolve their compiled package entry points
- [x] Exact money conversion/display helpers tested in `libs/common`
  (`money.spec.ts`); decimal input is parsed from strings, never floats
- [x] API health controller has an automated unit test
- [x] **You**: `pnpm install && pnpm db:generate && pnpm db:migrate && pnpm db:seed`
- [x] **You**: `pnpm dev:api` → confirm `GET /health` returns `{ status: "ok", userCount: 2 }`
- [x] **You**: `pnpm dev:worker` → confirm it logs the same user count
- **Done when**: both commands above show `userCount: 2`, and
  `pnpm db:studio` shows the seeded users, holdings table (empty), and 3
  price snapshots.

## Phase 2 — Auth
- [x] Create an Auth0 tenant, API identifier (this becomes `AUTH0_AUDIENCE`),
  and a test user
- [x] Add real `AUTH0_DOMAIN` / `AUTH0_AUDIENCE` values to `.env`
- [x] `apps/api`: add `@nestjs/passport`, `passport-jwt`, `jwks-rsa`
- [x] `apps/api/src/prisma/` — global injectable `PrismaService`
- [x] `apps/api/src/auth/auth.module.ts` — mark `@Global()`
- [x] `apps/api/src/auth/jwt.strategy.ts` — validates incoming JWTs against
  Auth0's JWKS endpoint using `AUTH0_DOMAIN` and checks `AUTH0_AUDIENCE`
- [x] `apps/api/src/auth/jwt-auth.guard.ts`
- [x] `apps/api/src/auth/public.decorator.ts` — `@Public()` to opt a route
  out of the otherwise-global guard
- [x] Register the guard globally via `APP_GUARD` in `app.module.ts`
- [x] Mark `HealthController`'s route `@Public()` so it stays open
- [x] Integration test: request without a token → 401; with a correctly
  signed RS256 token matching Auth0 issuer/audience semantics → 200 (JWKS
  retrieval is mocked, so CI does not depend on Auth0)
- **Done when**: the test above passes and `/health` still works
  unauthenticated.

## Phase 3 — Market data read path (fake the data source first)
- [x] `apps/api/src/redis/redis.module.ts` — `@Global()`, wraps an `ioredis`
  client (needed now, ahead of ingestion, because the cache-aside logic
  depends on it)
- [x] `apps/api/src/market/market.module.ts`
- [x] `apps/api/src/market/market.controller.ts` — `GET /indices`,
  `GET /stocks/:symbol`
- [x] `apps/api/src/market/market.service.ts` — cache-aside: check Redis
  first (`price:{symbol}`), fall back to the latest `PriceSnapshot` row via
  Prisma on a miss, populate the cache after
- [x] `apps/api/src/market/dto/` — response DTOs (exact BigInt paise values
  are serialized as decimal strings because JSON cannot encode BigInt)
- [x] Do NOT wait for real Upstox data — the 3 seeded fake prices from Phase
  1 are enough to build and fully test this layer
- [x] Unit tests (`market.service.spec.ts`) with mocked Prisma + Redis
- [x] Integration test covering both the cache-hit and cache-miss path
- **Done when**: endpoints return correct data whether or not Redis has a
  cached value, proven by tests against the fake seeded data.

## Phase 4 — Portfolio read path
- [x] `apps/api/src/portfolio/portfolio.module.ts`
- [x] `apps/api/src/portfolio/portfolio.controller.ts` — `GET /portfolio`
- [x] `apps/api/src/portfolio/portfolio.service.ts` — joins `Holding` rows
  with current prices (via `MarketService`) to compute unrealized P&L
- [x] Unit tests (`portfolio.service.spec.ts`): zero holdings, multiple buy
  lots at different prices (average cost basis), a fully sold position
- **Done when**: all three P&L edge cases above are covered by passing tests.

## Phase 5 — Orders and execution (the hard part — budget the most time here)
- [x] Add `@nestjs/bullmq` + `bullmq` to `apps/api` (producer) and BullMQ's
  direct worker API to `apps/worker` (consumer)
- [x] `apps/api/src/orders/orders.module.ts`
- [x] `apps/api/src/orders/dto/create-order.dto.ts` — `class-validator`
  decorated (symbol, side, quantity)
- [x] `apps/api/src/orders/orders.controller.ts` — `POST /orders`
- [x] `apps/api/src/orders/orders.service.ts` — validates the DTO only
  (never balance — that's the worker's job), writes a `PENDING` `Order` row,
  enqueues a BullMQ job carrying `userId`, returns `202 Accepted`
  immediately
- [x] `apps/worker/src/execution/order-processor.ts` — BullMQ OSS worker uses
  queue-global concurrency 1, which strictly prevents same-user overlap even
  across processes; row locks remain the database correctness guarantee
- [x] Pending-order reconciliation loop re-enqueues durable DB rows by
  deterministic order/job id after an API-to-Redis handoff failure
- [x] `apps/worker/src/execution/execute-order.ts` — the correctness-critical
  core: `prisma.$transaction` wrapping a `SELECT ... FOR UPDATE` (or
  `Serializable` isolation) on the user row, check funds/shares, debit or
  credit balance, upsert the `Holding`, mark the `Order` `FILLED` or
  `REJECTED`, insert a `Transaction` row — all inside the one transaction
- [x] Idempotency guard at the top of `execute-order.ts`: no-op if the order
  is no longer `PENDING`
- [x] Publish filled/rejected order events to Redis pub/sub only AFTER
  the transaction commits — never before; persist delivery state so a failed
  publication retries without reapplying the trade
- [x] Persist exact aggregate holding cost basis separately from the
  integer-paise display average, with DB constraints protecting nonnegative
  balances/holdings/prices and positive order quantities
- [x] Configure a BullMQ dead-letter queue for jobs that exhaust retries,
  plus an alert/log when that happens
- [x] `execute-order.spec.ts` — unit tests: insufficient funds, insufficient
  shares on sell, idempotent replay of an already-processed order
- [x] `concurrency.spec.ts` — **the single most important test in this
  project**: fire many parallel buy/sell orders at the same user and assert
  the final balance and holdings are exactly correct, every run (run it
  several times, not once)
- **Done when**: the concurrency test passes consistently and every
  rejection path above is covered.

## Phase 6 — Real ingestion (Upstox)
- [x] Relocate root `nse_top_100.json` to
  `libs/common/src/data/nse-top-100.json`; add a strict shared loader/schema,
  expose typed instrument-key ↔ trading-symbol maps, and fail startup on
  invalid/duplicate entries
- [x] `apps/api`: add paginated, case-insensitive local search over the 100
  instruments (`GET /stocks?query=&page=&limit=`); never call Upstox from a
  website search request
- [x] Validate `UPSTOX_ANALYTICS_TOKEN` at worker startup; no TOTP/daily-auth
  job or API key/secret flow
- [x] `apps/worker/src/ingestion/upstox-client.ts` — calls the market-data
  V3 authorize endpoint, opens its one-use WSS URL, subscribes to all 100
  instrument keys in LTPC mode
- [x] `apps/worker/src/ingestion/tick-decoder.ts` — protobuf decoding of the
  v3 feed format
- [x] `apps/worker/src/ingestion/tick-handler.ts` — per tick: update the
  Redis cache key and publish to pub/sub synchronously (latency-sensitive
  path); retain only the latest buffered tick per symbol
- [x] `apps/worker/src/ingestion/snapshot-flusher.ts` — flushes the buffer to
  `PriceSnapshot` via a batched insert every few seconds (throughput-sensitive
  path, deliberately decoupled from the cache/pub-sub path)
- [x] Reconnect-with-exponential-backoff wrapper around the WS client
- [x] Market-hours guard using Upstox's date-specific NSE session (covers
  weekdays, holidays, and special sessions) for the
  ingestion connection
- [x] `apps/worker/src/ingestion/upstox-rest-fallback.ts` — temporary REST
  fallback using one batched LTP request for all 100 keys with conservative
  rate limiting, plus an alert
- [x] Tests: mock a WebSocket server to test reconnect/backoff and tick
  handling — never depend on a live Upstox connection in CI
- [x] Closed-market LTP snapshot: one batched REST LTP load per closed period
  (startup + after each session, retried on failure) so closing prices are
  served outside market hours; verified live — 100 prices in Redis and
  `price_snapshots` with the market closed
- [ ] Live completion gate (run during an open NSE session): start API +
  worker and verify `MarketModule` reflects real streamed prices for configured
  symbols. Token authorization, market timings, and one 100-key LTP batch have
  already been verified successfully against Upstox.
- **Done when**: local search paginates exactly the 100 configured equities;
  with the market open, `MarketModule` reflects their real prices; reconnect
  logic is proven against a simulated drop.

## Frontend (parallel track — `apps/web`, started at the user's request)

Runs alongside the backend phases; it consumes only endpoints that already
exist and must not change backend code on its own.

- [x] Scaffold `apps/web` (Vite + React + TypeScript) in the pnpm workspace,
  with the prototype's theme, fonts, and light/dark modes
- [x] Auth0 SPA login (`@auth0/auth0-react`) plus a `mock` mode needing no
  Auth0/API/worker; dev proxy `/api` → `localhost:3000`
- [x] Landing page, market list (paginated local catalog search + polled
  prices), topbar search, stock detail with session chart and order ticket,
  portfolio (BigInt totals, P&L %, allocation), orders, profile/settings
- [x] Vitest suite: money formatting/parsing, HTTP client error mapping, mock
  settlement math, order-ticket validation/submission, portfolio rendering
- [x] **You**: create an Auth0 *Single Page Application*, set Callback
  `http://localhost:5173/app`, Logout and Web Origin `http://localhost:5173`,
  enable Refresh Token Rotation (and "Allow Offline Access" on the API), then
  fill `apps/web/.env.local` from `apps/web/.env.example` — done; the SPA and
  the custom API (identifier `https://tradesim-api`, RS256) live in the same
  tenant, and `AUTH0_AUDIENCE` / `VITE_AUTH0_AUDIENCE` both use it. Never use
  the Auth0 Management API (`…/api/v2/`) or another tenant's API as audience
  (Auth0 answers "Service not found")
- [x] Live login verified: Google sign-in works and the market shows real
  closing LTPs from the worker
- [x] Link the developer's Auth0 user to a trading profile: seeded
  `trader1@example.com` now has `auth0Id = google-oauth2|…` (re-running the
  seed does not overwrite it — the upsert's `update` is empty)
- [ ] **You**: verify the portfolio page and a buy/sell round-trip that settles
  in live mode (orders fill only while prices are available; with the market
  closed they fill at the closing LTP)
- [ ] Backend follow-ups the UI currently works around (schedule into the
  backend phases; not done from the frontend track):
  - `GET /orders` (history + final status/fill price) — Orders page uses a
    local per-browser log instead
  - user provisioning on first login (e.g. `POST /me` creating a ₹1,00,000
    profile keyed by the JWT `sub`) — new Auth0 users currently see "No
    trading account linked" and need a manual `users."auth0Id"` update;
    each Auth0 connection (Google vs. password) yields a different `sub`
  - price history / previous close for real day change and charts — the UI
    shows session-observed change only
  - CORS (or a same-origin reverse proxy) for production deploys
- [ ] Swap price/portfolio polling for the Phase 7 WebSocket gateway once it
  exists
- **Done when**: a real Auth0 user can sign in, see live prices and their
  portfolio, and place a buy and a sell that settle, against the running API
  and worker.

## Phase 7 — Real-time delivery + CI/observability
- [ ] `apps/api/src/realtime/realtime.module.ts`
- [ ] `apps/api/src/realtime/realtime.gateway.ts` — `@WebSocketGateway()`,
  authenticates the handshake token against Auth0, subscribes to the Redis
  price-tick and order-fill channels, forwards events to the right connected
  client
- [ ] Manual end-to-end check with a WS client (e.g. `wscat`)
- [ ] `.github/workflows/ci.yml` — lint + unit + integration tests on every
  PR, with Postgres and Redis as service containers
- [ ] Structured logging (`pino` / `nestjs-pino`) in both `apps/api` and
  `apps/worker`
- [ ] Basic error tracking (Sentry free tier) wired into both apps
- **Done when**: CI is green on a fresh PR, a WS client sees live ticks, and
  `/health` still works.

## Phase 8 — AI feature
- [ ] Decide: portfolio chat assistant (agentic, tool-calling against your
  own API) vs. AI daily portfolio summary — revisit the earlier discussion
  if unsure
- [ ] `apps/api/src/ai/ai.module.ts` + implementation of the chosen feature

## Phase 9 — Deploy & polish
- [ ] Provision managed Postgres + Redis (Railway/Render/Fly)
- [ ] Deploy `apps/api` and `apps/worker` as separate services
- [ ] Root `README.md` with the architecture diagram embedded
- [ ] Record a short demo video/GIF
- [ ] Finalize the resume bullet, naming the specific hard problem solved
  (e.g. "resolved race conditions in concurrent order execution using
  PostgreSQL row-level locking and transactional isolation")
