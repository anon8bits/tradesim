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
- [ ] **You**: open a free Upstox demat account (KYC via PAN + Aadhaar, zero
  balance is fine), register as a developer, get an API key + secret
- [ ] **You**: download Upstox's instrument master file, pick ~20-30 curated
  instrument keys (Nifty 50 names + 1-2 indices), replace the placeholder
  `CURATED_SYMBOLS` in `libs/common/src/index.ts`

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
- [ ] `apps/api/src/portfolio/portfolio.module.ts`
- [ ] `apps/api/src/portfolio/portfolio.controller.ts` — `GET /portfolio`
- [ ] `apps/api/src/portfolio/portfolio.service.ts` — joins `Holding` rows
  with current prices (via `MarketService`) to compute unrealized P&L
- [ ] Unit tests (`portfolio.service.spec.ts`): zero holdings, multiple buy
  lots at different prices (average cost basis), a fully sold position
- **Done when**: all three P&L edge cases above are covered by passing tests.

## Phase 5 — Orders and execution (the hard part — budget the most time here)
- [ ] Add BullMQ (`@nestjs/bullmq`, `bullmq`) to both `apps/api` (producer)
  and `apps/worker` (consumer)
- [ ] `apps/api/src/orders/orders.module.ts`
- [ ] `apps/api/src/orders/dto/create-order.dto.ts` — `class-validator`
  decorated (symbol, side, quantity)
- [ ] `apps/api/src/orders/orders.controller.ts` — `POST /orders`
- [ ] `apps/api/src/orders/orders.service.ts` — validates the DTO only
  (never balance — that's the worker's job), writes a `PENDING` `Order` row,
  enqueues a BullMQ job keyed/grouped by `userId`, returns `202 Accepted`
  immediately
- [ ] `apps/worker/src/execution/order-processor.ts` — BullMQ worker,
  concurrency configured so jobs for the same user never run in parallel
- [ ] `apps/worker/src/execution/execute-order.ts` — the correctness-critical
  core: `prisma.$transaction` wrapping a `SELECT ... FOR UPDATE` (or
  `Serializable` isolation) on the user row, check funds/shares, debit or
  credit balance, upsert the `Holding`, mark the `Order` `FILLED` or
  `REJECTED`, insert a `Transaction` row — all inside the one transaction
- [ ] Idempotency guard at the top of `execute-order.ts`: no-op if the order
  is no longer `PENDING`
- [ ] Publish `order.filled` / `order.rejected` to Redis pub/sub only AFTER
  the transaction commits — never before
- [ ] Configure a BullMQ dead-letter queue for jobs that exhaust retries,
  plus an alert/log when that happens
- [ ] `execute-order.spec.ts` — unit tests: insufficient funds, insufficient
  shares on sell, idempotent replay of an already-processed order
- [ ] `concurrency.spec.ts` — **the single most important test in this
  project**: fire many parallel buy/sell orders at the same user and assert
  the final balance and holdings are exactly correct, every run (run it
  several times, not once)
- **Done when**: the concurrency test passes consistently and every
  rejection path above is covered.

## Phase 6 — Real ingestion (Upstox)
- [ ] `apps/worker/src/ingestion/daily-auth-job.ts` — TOTP-automated Upstox
  login, writes the access token to Redis (short TTL matching Upstox's daily
  expiry, ~3:30 AM IST)
- [ ] `apps/worker/src/ingestion/upstox-client.ts` — calls the market-data
  `authorize` endpoint, opens the WebSocket, subscribes to `CURATED_SYMBOLS`
  instrument keys
- [ ] `apps/worker/src/ingestion/tick-decoder.ts` — protobuf decoding of the
  v3 feed format
- [ ] `apps/worker/src/ingestion/tick-handler.ts` — per tick: update the
  Redis cache key and publish to pub/sub synchronously (latency-sensitive
  path); push into an in-memory buffer
- [ ] `apps/worker/src/ingestion/snapshot-flusher.ts` — flushes the buffer to
  `PriceSnapshot` via a batched insert every few seconds (throughput-sensitive
  path, deliberately decoupled from the cache/pub-sub path)
- [ ] Reconnect-with-exponential-backoff wrapper around the WS client
- [ ] Market-hours guard (Mon-Fri, 9:15-3:30 IST, skip holidays) shared by
  both the daily auth job and the ingestion connection
- [ ] `apps/worker/src/ingestion/upstox-rest-fallback.ts` — temporary REST
  polling of the LTP endpoint if WS reconnect fails repeatedly, plus an alert
- [ ] Tests: mock a WebSocket server to test reconnect/backoff and tick
  handling — never depend on a live Upstox connection in CI
- **Done when**: with the market open, `MarketModule` endpoints reflect real
  live prices, and reconnect logic has been proven against a simulated drop.

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
