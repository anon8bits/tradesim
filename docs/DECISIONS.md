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

## 2026-09-13 — Globally sequential BullMQ OSS order execution

**Why**: Per-group concurrency is a BullMQ Pro feature, not available in the
open-source queue selected for this project. The execution worker therefore
uses global concurrency 1. This is stricter and lower-throughput than the
original per-user grouping design, but it guarantees same-user orders never
overlap. A parameterized `SELECT ... FOR UPDATE` user-row lock remains the
database correctness boundary and is the one documented raw SQL exception.

**Tradeoff accepted**: orders for different users are also serialized. If
throughput later matters, adopt BullMQ Pro groups or a tested distributed
per-user lock before raising worker concurrency; never raise it without a
replacement sequencing mechanism.

**Alternatives considered**: one queue per user (unbounded queue lifecycle);
using `jobId=userId` (incorrectly deduplicates legitimate orders); relying only
on concurrent workers plus row locks (keeps balances safe but violates the
explicit no-overlap rule).

## 2026-09-13 — Database-backed queue reconciliation and event delivery state

**Why**: Writing an order to PostgreSQL and enqueueing it in Redis cannot be
one atomic transaction. PostgreSQL is therefore the durable source: the API
returns 202 once the `PENDING` row exists, attempts immediate enqueue, and a
worker loop reconciles pending rows using deterministic order/job ids. For the
opposite boundary, order outcome, rejection reason, and unpublished-event
state commit together; Redis publication happens afterward and sets
`eventPublishedAt`, giving retryable at-least-once delivery without executing
the trade twice.

Exact `Holding.costBasisCents` is persisted separately from the integer-paise
display average so repeated buys do not compound division truncation. Additive
database checks reject invalid negative balances/holdings/prices and
non-positive order quantities even if data bypasses the HTTP validator.

**Alternatives considered**: marking an order rejected when enqueue responds
ambiguously (races a worker that received the job); a full generic outbox
table/dispatcher (more infrastructure than this single event flow needs);
storing only rounded average cost (loses real basis over repeated trades).

## 2026-10-06 — Load closing LTPs once per closed market period

**Why**: The market-hours guard kept ingestion fully idle outside sessions,
so a fresh environment (or one whose Redis was flushed) had no prices until
the next open. Outside a session Upstox's batched LTP endpoint returns the
closing price, so the supervisor reuses the existing REST fallback once per
closed period and routes results through the normal `TickHandler`. That is
one request per closed period instead of polling, so it costs almost no rate
limit, and the WebSocket still never connects while the market is closed.

**Tradeoff accepted**: the snapshot's `ts` is the fetch time, because the LTP
response has no trade timestamp.

**Alternatives considered**: a manual seed script (easy to forget, leaves
prices stale); polling LTP all night (wasted calls, since the price can't
change); storing previous close from the V3 feed only (absent until the
first session after a fresh start).

## 2026-10-06 — Frontend as `apps/web` (Vite + React) against the existing API only

**Why**: The frontend lives in the monorepo so it can reuse `libs/common`
(the `paiseToDisplayRupees` helper and the top-100 catalog) from TypeScript
source via a Vite alias. The package ships CommonJS for Node, so the browser
build compiles its browser-safe source directly. Vite + React Router + TanStack
Query keeps the SPA small and makes polling-now / WebSocket-later a local
change. The UI was built without touching backend code, so it proxies `/api`
in dev (the API has no CORS), polls prices until Phase 7, and keeps a local
per-browser order log because there is no order-history endpoint. A `mock` API
mode implementing the same interface lets the UI run and be tested without
Auth0, Postgres, Redis, or the worker. In-browser money stays BigInt paise.

**Alternatives considered**: a separate repository (loses shared catalog and
money helpers, duplicates types); Next.js (SSR adds a server tier this
API-backed dashboard doesn't need); adding CORS/order-history endpoints first
(explicitly out of scope for this change, so they are tracked as follow-ups in
`docs/TASKS.md`).

## 2026-10-02 — Analytics Token and fixed top-100 NSE universe

**Why**: Upstox now provides a one-year, read-only Analytics Token that
supports Market Data Feed V3, making the earlier daily OAuth/TOTP automation
unnecessary and less secure. Phase 6 reads `UPSTOX_ANALYTICS_TOKEN` from the
environment and requests a fresh one-use authorized WSS URL on every
connection.

The website universe comes from the supplied root `nse_top_100.json`, validated
at 100 unique NSE equity keys/symbols, then becomes the versioned shared asset
`libs/common/src/data/nse-top-100.json` during implementation. One hundred
metadata records are safe to load in both API and worker memory: the API
performs local search/pagination, and the worker subscribes to all keys in LTPC
mode. This avoids provider calls per user search while remaining far below
Upstox's documented feed limit. Postgres buffering retains only the latest tick
per symbol between flushes.

**Alternatives considered**: daily TOTP login (superseded by the Analytics
Token); querying Upstox Instrument Search per website request (shares one
provider rate limit across all users); importing the complete exchange
universe into PostgreSQL (unnecessary complexity for the chosen fixed 100);
manually maintaining a 20–30-symbol TypeScript constant (too small and less
auditable than the validated JSON catalog).

## 2026-10-02 — Provider market timings instead of a hardcoded holiday list

**Why**: the Phase 6 ingestion guard must skip NSE trading holidays, but a
checked-in holiday list becomes stale every year and misses special sessions.
The worker asks Upstox's date-specific market-timings endpoint for the NSE
session and caches that result for the Indian calendar date. No NSE timing
means closed; a request failure also fails closed and is retried. This keeps
the persistent feed off outside the provider-declared session without silently
guessing around holidays.

**Alternatives considered**: maintaining annual holiday arrays in source
(ongoing manual updates); using only Mon-Fri 9:15–15:30 IST (connects on
holidays and misses special sessions); keeping the feed connected continuously
(unnecessary provider connection usage).

<!-- Add new entries above this line, newest first. -->

