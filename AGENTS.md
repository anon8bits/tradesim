# AGENTS.md — TradeSim

This is the canonical context file for any AI coding agent (Claude Code, Cursor,
Copilot, etc.) working on this repo. Read this fully before starting a task.
Tool-specific files (`CLAUDE.md`, `.cursor/rules/*.mdc`,
`.github/copilot-instructions.md`) all just point back here — update THIS file,
not those.

## What this project is

TradeSim is a paper-trading simulator: users get virtual cash, can buy/sell
real stocks at real (delayed) prices, and track portfolio performance. It's a
personal/portfolio project, rebuilt from an earlier CRUD version, with the
explicit goal of demonstrating production-grade backend engineering: real-time
data, correct concurrent financial transactions, and (later) an AI-assisted
portfolio feature. Optimize for correctness and clarity over cleverness.

## Tech stack

- **Backend**: NestJS (TypeScript), organized as `apps/api` (HTTP + WebSocket
  gateway) and `apps/worker` (BullMQ processors), sharing `libs/db` and
  `libs/common`.
- **Database**: PostgreSQL via Prisma. Chosen over the original MongoDB
  specifically for multi-row ACID transactions on financial data — see
  `docs/DECISIONS.md`.
- **Cache / queue / pub-sub**: Redis (via `ioredis` + BullMQ).
- **Auth**: Auth0 (JWT, validated via `passport-jwt` + JWKS).
- **Market data**: Upstox Market Data Feed V3 (push-based, not polled), using
  a one-year read-only Analytics Token from the environment. The fixed website
  universe is the 100 validated NSE equities supplied in root
  `nse_top_100.json` and moved into `libs/common/src/data/` during Phase 6; the
  worker subscribes to all 100 in LTPC mode and the API searches/paginates this
  local catalog without calling Upstox per request.
- **Frontend**: `apps/web` — Vite + React + TypeScript SPA (React Router,
 TanStack Query, `@auth0/auth0-react`), styled from the root
 `TradeSim Prototype.html` theme (Fraunces / Public Sans / IBM Plex Mono,
 dark ledger palette with light mode). It consumes only the existing HTTP
 API through a dev proxy (`/api` → `localhost:3000`) and has a `mock` mode
 (`VITE_API_MODE=mock`) that runs the full UI without Auth0/API/worker. Money
 stays BigInt paise in the browser too; display goes through `libs/common`'s
 `paiseToDisplayRupees` (imported from source).
- **Infra**: Docker Compose locally; Railway/Render/Fly + managed
  Postgres/Redis in production (no more Azure student credits).

## Architecture summary

- `apps/api` — NestJS gateway. Feature modules: `MarketModule` (read-only
  prices/indices, cache-first), `PortfolioModule` (read-only holdings/balance),
  `OrdersModule` (validates + enqueues orders, returns 202 immediately, never
  executes trades inline), `RealtimeModule` (WebSocket gateway, subscribes to
  Redis pub/sub for price ticks and order-fill events). Core modules
  (`ConfigModule`, `PrismaModule`, `RedisModule`, `AuthModule`) are `@Global()`.
- `apps/worker` — two independent pipelines, kept fully separate so one never
  blocks the other:
  - **price ingestion**: not a polling cron. A long-lived process reads the
    Analytics Token from the environment, requests a one-use authorized V3
    WebSocket URL on each connect/reconnect, and subscribes to all instrument
    keys in the shared top-100 catalog in LTPC mode during market hours. Each
    tick maps the instrument key to its trading symbol, updates Redis, and
    publishes to Redis pub/sub immediately (latency-sensitive path); the latest
    buffered tick per symbol is flushed to Postgres every few seconds
    (throughput-sensitive path).
  - **order execution**: a BullMQ queue consumes jobs carrying `userId`. The
    open-source worker currently runs at global concurrency 1 (BullMQ
    per-group concurrency is a Pro feature), so two same-user orders never
    overlap. Each job wraps the whole check-and-apply logic in a single
    Postgres transaction with a row-level lock on the user
    (`SELECT ... FOR UPDATE`) → commits or rejects atomically → publishes the
    fill event only after commit.
- Full diagrams live in `docs/ARCHITECTURE.md`.

## Conventions

- TypeScript strict mode everywhere. No `any` without a comment explaining why.
- NestJS: constructor injection, one module per bounded feature, DTOs with
  `class-validator` decorators on every controller input.
- Prisma for all DB access — no raw SQL except inside explicitly documented
  performance-critical queries.
- Every function that touches money, balances, or holdings needs a test.
  This is non-negotiable — it's the whole point of the rebuild.
- Conventional commits (`feat:`, `fix:`, `chore:`, `test:`, ...).
- Prefer small, reviewable PRs/commits over large ones, even when working solo.

## Current status

**Phase 0 (local Docker) and Phase 1 (data foundation) are done.** Migration
`20260905190945_init` is applied, seed data is in Postgres (2 users, 0
holdings, 3 price snapshots), and the API health and shared money helpers
have automated tests. **Phase 2 (Auth0 authentication) is also done:** its
JWKS strategy, global guard, public health route, and injectable Prisma
service are implemented and tested, and the real Auth0 tenant configuration
is present locally. **Phase 3 (market read path) is done:** the global Redis
client and authenticated market endpoints use cache-aside reads with exact
price serialization, covered by unit tests and live Postgres/Redis integration
tests. **Phase 4 (portfolio read path) is done:** the authenticated portfolio
endpoint calculates holdings value and unrealized P&L entirely with `BigInt`,
including zero-holding, weighted-average-cost, and fully-sold-position tests.
**Phase 5 (orders and execution) is done:** authenticated order submission,
queue-global sequential BullMQ processing, pending-order reconciliation,
transactional row locking, exact aggregate cost basis, idempotency,
retryable post-commit events, a DLQ, DB financial constraints, and repeated
real-Postgres contention tests are in place. **Phase 6 implementation is
complete but its final live gate is still pending:** the versioned 100-equity
catalog, local paginated search, Analytics Token validation, Market Data Feed
V3 protobuf ingestion, provider-sourced NSE session guard, immediate Redis
cache/pub-sub path, deduplicated Postgres batches, reconnect/backoff, and
rate-limited batched REST fallback are implemented and covered by tests.
Live Upstox authorization, market timings, and a 100-key LTP batch have
succeeded; outside market hours the worker now loads closing LTPs once per
closed period, so the site always has prices; before marking Phase 6 done or starting Phase 7, run API + worker
during an open NSE session and verify `MarketModule` reflects streamed prices.
Phase 7 modules (`realtime/`, CI/observability) and later phases do not exist.
**Frontend track (parallel, user-requested):** `apps/web` exists with landing,
market, stock detail + order ticket, portfolio, orders, and profile pages; it
polls prices until the Phase 7 WebSocket lands. Live Auth0 login is verified
(SPA + custom API `https://tradesim-api` in one tenant; both env files use that
audience) and the market shows real closing LTPs. Trading accounts are
`users` rows matched by JWT `sub` (`User.auth0Id`); there is no
self-provisioning yet, so new logins must be linked in the database. Backend gaps it works around
(no order-history/status, user provisioning, or price-history endpoints; no
CORS) are listed under "Frontend" in `docs/TASKS.md`.

**Full phase-by-phase status, with checkboxes, lives in `docs/TASKS.md` — that
file, not this summary, is the source of truth for what to build next.**

## How to work through this project

Phases are ordered so each one builds on tests already passing in the last
one — don't skip ahead even if a later phase looks easier or more
interesting.

1. Open `docs/TASKS.md`, find the first phase with unchecked items.
2. Read the relevant section(s) of `docs/ARCHITECTURE.md` for that phase
   before writing code — the data model, the relevant flow diagram, and the
   repository layout all live there.
3. Implement the unchecked items for that phase only, at the file paths
   `docs/TASKS.md` specifies.
4. Write the tests that phase's "Done when" line calls for. Don't consider
   the phase finished until they pass.
5. Check off the completed items in `docs/TASKS.md`.
6. If you made a non-obvious design call along the way, add a short entry to
   `docs/DECISIONS.md` before moving on.
7. Only then move to the next phase.

### Phase completion gate

Before checking off a phase or starting the next one, every agent must:

- Run the repository lint, test, and production build commands required by
  the files it changed, plus every phase-specific suite named in this file or
  `docs/TASKS.md`.
- Verify the phase's complete **Done when** condition, including runtime or
  integration checks. Human-only checks may be accepted only after the user
  explicitly confirms them.
- Fix failures within scope. If a required check cannot run or fails, leave
  the phase incomplete and report the exact blocker; never mark it done based
  only on code inspection.
- Update `docs/TASKS.md` only after the checks pass, and list the checks run in
  the final handoff.

If a `docs/TASKS.md` item is marked `**You**:` — that's a manual step
(opening an account, running a command, checking output) the human needs to
do; don't try to automate around it, just prompt for it to be done and wait.

## Repository layout & data model

Full details (including which folders map to which phase) live in
`docs/ARCHITECTURE.md` under "Repository layout" and "Data model" — read
those before creating new files so new code lands in the right module.

## Instructions for AI agents specifically

- Before making changes, check `docs/ARCHITECTURE.md` and `docs/DECISIONS.md`
  so you don't contradict an already-made design decision — if you think a
  decision should change, say so and ask rather than silently diverging.
- Don't invent a stock data API response shape — ask, or check
  `libs/common` for the existing type if one exists.
- For anything in `apps/worker/src/execution`, prioritize correctness and
  explicit tests over speed of implementation.
- Whenever project scope, architecture, external credentials, data universe,
  or phase plan changes, update the relevant summary/status in this canonical
  `AGENTS.md` and the detailed architecture/task/decision docs in the same
  change so future agents do not follow stale guidance.
- After finishing a task, update `docs/TASKS.md` and, if you made a
  non-obvious design choice, add a short entry to `docs/DECISIONS.md`.
- If a task is ambiguous, make a reasonable assumption, state it, and proceed
  — but flag it clearly rather than burying it silently in the diff.
