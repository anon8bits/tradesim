# Decisions log (lightweight ADRs)

Format: Date — Decision — Why — Alternatives considered.

## 2026-09-03 — PostgreSQL instead of MongoDB for the core ledger

**Why**: Orders, holdings, and balances require atomic multi-row updates
(deduct cash, insert order, update holding, all-or-nothing) and benefit from
foreign-key constraints between users/orders/holdings. Postgres transactions
give this natively; modeling the same guarantees in MongoDB is possible but
more work and less idiomatic.

**Alternatives considered**: Keep MongoDB with multi-document transactions —
workable but relational structure fits the domain better.

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

## 2026-09-10 — Build shared libraries before starting either app

**Why**: `@tradesim/db` constructs a `PrismaClient` at import time. Nest's
`ConfigModule` therefore cannot inject `DATABASE_URL` in time for the worker
or legacy direct imports. Root `dev:api` / `dev:worker` still load `.env`
before app startup, but now build `libs/common` and `libs/db` first. Shared
packages expose `dist` entry points and application TypeScript configs resolve
their declarations there. This keeps source files outside each app's
`rootDir`, allowing both development startup and production builds to work.

**Alternatives considered**: exporting workspace TypeScript source directly
(worked under `tsx` but broke `tsc`/Nest production builds because shared
source lies outside app `rootDir`); widening each app's `rootDir` (produces an
incorrect output layout). Phase 2 now uses a Nest `PrismaService` in the API;
the worker continues to use the shared client.

## 2026-09-11 — Use Nest CLI watch mode for the API

**Why**: Phase 2 introduced constructor-injected Nest providers. `tsx watch`
transpiles quickly but does not emit the decorator metadata Nest needs to
resolve constructor parameter types, so `ConfigService` reached `JwtStrategy`
as `undefined`. `nest start --watch` uses the configured TypeScript compiler
and preserves dependency-injection metadata. Shared libraries are already
built before API startup, so the original cross-workspace compilation issue
does not return.

**Alternatives considered**: adding explicit `@Inject()` decorators to every
constructor (works but is repetitive and easy to forget); continuing with
`tsx` (unsafe for conventionally injected Nest providers).

## 2026-09-11 — Serialize exact prices as decimal strings at JSON boundaries

**Why**: Prices are `BigInt` paise in services and database calculations, but
native JSON cannot serialize `BigInt`. Redis cache values and HTTP DTOs use
base-10 strings and convert back to `BigInt` immediately when read. The
cache-aside path treats Redis reads/writes as best-effort so a cache outage or
malformed entry falls back to PostgreSQL rather than failing price requests.

**Alternatives considered**: JSON numbers (can silently lose integer
precision); display-formatted rupee strings (mix presentation with the domain
value); failing requests when Redis is unavailable (makes an optimization a
hard dependency).

<!-- Add new entries above this line, newest first. -->

