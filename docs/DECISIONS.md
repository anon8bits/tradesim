# Decisions log (lightweight ADRs)

Format: Date — Decision — Why — Alternatives considered.

## 2026-09-03 — PostgreSQL instead of MongoDB for the core ledger

**Why**: Orders, holdings, and balances require atomic multi-row updates
(deduct cash, insert order, update holding, all-or-nothing) and benefit from
foreign-key constraints between users/orders/holdings. Postgres transactions
give this natively; modeling the same guarantees in MongoDB is possible but
more work and less idiomatic.

**Alternatives considered**: Keep MongoDB with multi-document transactions —
workable but relational structure fits the domain better, and this is a
stronger interview talking point.

## 2026-09-03 — NestJS instead of raw Express

**Why**: Modules, dependency injection, guards, and a built-in WebSocket
gateway give the codebase real structure without leaving the Node/TypeScript
ecosystem. Shallow learning curve coming from Express.

**Alternatives considered**: Express (too unstructured for this scope), Go
(would demonstrate polyglot skills but slows down delivery and isn't needed
to hit the project's goals).

## 2026-09-03 — BullMQ + Redis instead of Azure Functions cron

**Why**: Gives retries, backoff, dead-letter handling, and per-user job
sequencing for orders — none of which a bare scheduled function provides.
Also removes the dependency on Azure student credits.

**Alternatives considered**: Azure Functions (original approach, now also
unavailable), a simple `node-cron` in-process (no retry/backoff/observability).

## 2026-09-05 — Upstox API (WebSocket) instead of a polled REST API for prices

**Why**: A genuinely real-time project needs push-based data, not a 5-minute
poll. No free, no-account public firehose exists for NSE/BSE — that data is
licensed — but Upstox provides a free WebSocket market-data feed to any
registered account holder (zero-balance demat account is fine), and has an
official Node/TypeScript SDK that fits this stack directly.

**Tradeoff accepted**: requires opening a real (free) broker account and KYC,
and Upstox access tokens expire daily with no refresh token on the free tier
— needs a small TOTP-automated daily login job. Also: this API is licensed
for the account holder's own use, not for reselling market data to many
users — fine for a personal/portfolio project, not something to represent as
a production redistribution product.

**Alternatives considered**:
- **Finnhub** (free WebSocket feed, no broker account, US/global symbols) —
  much lower setup friction and no redistribution caveat, but doesn't give
  NSE/BSE relevance for Indian trading learners, which was a project goal.
- **Zerodha Kite Connect** — no longer free (monthly API fee), ruled out.
- **Angel One SmartAPI** — comparable free option, kept as a fallback if
  Upstox account opening is ever blocked.
- **Unofficial NSE scraping** (`nsepython`, `jugaad-data`) — free but fragile,
  polling-based (not push), and in a legal gray area; not worth it when a
  real broker API solves the problem properly.

## 2026-09-05 — Load `.env` before process start; run the API with `tsx`

**Why**: `@tradesim/db` constructs a `PrismaClient` at import time. Nest's
`ConfigModule` therefore cannot inject `DATABASE_URL` in time for the Phase 1
health check (or the worker's startup count). Root `dev:api` / `dev:worker`
wrap the process with `dotenv-cli` so the URL is in the environment before
any import. The API `dev` script uses `tsx watch` (same as the worker) so
workspace packages that export TypeScript (`main: src/index.ts`) resolve
without a Nest webpack monorepo setup.

**Alternatives considered**: Nest `ConfigModule` + `nest start --watch`
(too late for the Prisma singleton, and `tsc`/`nest` cannot compile
workspace `.ts` entrypoints outside `apps/api/src`). A Nest `PrismaService`
wrapper is still planned for Phase 2.

<!-- Add new entries above this line, newest first. -->

