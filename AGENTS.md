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
portfolio feature. Optimize for correctness and clarity over cleverness —
this code will be read by interviewers.

## Tech stack

- **Backend**: NestJS (TypeScript), organized as `apps/api` (HTTP + WebSocket
  gateway) and `apps/worker` (BullMQ processors), sharing `libs/db` and
  `libs/common`.
- **Database**: PostgreSQL via Prisma. Chosen over the original MongoDB
  specifically for multi-row ACID transactions on financial data — see
  `docs/DECISIONS.md`.
- **Cache / queue / pub-sub**: Redis (via `ioredis` + BullMQ).
- **Auth**: Auth0 (JWT, validated via `passport-jwt` + JWKS).
- **Market data**: Upstox API v2 WebSocket market-data feed (push-based, not
  polled), scoped to a curated list of ~20-30 NSE symbols/indices. Access
  tokens expire daily (~3:30 AM IST) and are refreshed by an automated
  TOTP-based daily auth job — see `docs/ARCHITECTURE.md`.
- **Frontend**: React (separate repo/app, not covered by this file yet).
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
  - **price ingestion**: not a polling cron. A daily auth job (TOTP-automated
    login against Upstox) writes a fresh access token to Redis each morning.
    A long-lived ingestion process reads that token, opens a persistent
    WebSocket connection to the Upstox market-data feed (market hours only),
    and subscribes to a curated instrument list. Each tick updates the Redis
    cache and publishes to Redis pub/sub immediately (latency-sensitive path);
    ticks are also buffered and flushed to Postgres `price_snapshots` in small
    batches every few seconds (throughput-sensitive path, deliberately not
    synchronous with the cache/pub-sub path).
  - **order execution**: a BullMQ queue consumes orders, grouped/keyed by user
    id so two orders for the same user never process concurrently. Each job
    wraps the whole check-and-apply logic in a single Postgres transaction
    with a row-level lock on the user (`SELECT ... FOR UPDATE`) → commits or
    rejects atomically → publishes the fill event only after commit.
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

**Phase 0 (environment) and Phase 1 (data foundation) are scaffolded.** The
monorepo, Prisma schema, seed script, `/health` endpoint, and worker
placeholder all exist and `pnpm install` succeeds. What's NOT done yet: the
migration hasn't been run against a live Postgres, the Upstox account/curated
symbol list is still a placeholder, and every module from Phase 2 onward
(`auth/`, `market/`, `portfolio/`, `orders/`, `realtime/`, `ai/`, and the
worker's `execution/`/`ingestion/`) doesn't exist yet.

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
- After finishing a task, update `docs/TASKS.md` and, if you made a
  non-obvious design choice, add a short entry to `docs/DECISIONS.md`.
- If a task is ambiguous, make a reasonable assumption, state it, and proceed
  — but flag it clearly rather than burying it silently in the diff.
