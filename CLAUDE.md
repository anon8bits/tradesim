# CLAUDE.md

Read `AGENTS.md` first — it's the canonical project context (stack,
architecture, conventions, current status). This file only holds Claude
Code–specific setup.

## Before finishing any task

1. Run `pnpm lint` and `pnpm test` for any app you touched; fix failures
   before considering the task done.
2. If you touched `apps/worker/order-execution`, run the concurrency test
   suite specifically (`pnpm test:concurrency`) — this is the code path most
   likely to have subtle race-condition bugs.
3. Update `docs/TASKS.md` to reflect what changed.

## Useful subagents to create (`~/.claude/agents/`)

- `financial-logic-reviewer.md` — reviews any diff touching orders, balances,
  or holdings specifically for race conditions, missing transaction
  boundaries, and rounding errors.
- `test-writer.md` — given a service/controller, writes Jest tests matching
  existing test conventions in the repo.

## MCP servers worth connecting for this project

- GitHub (issue/PR context)
- Postgres (so Claude can inspect the actual schema/data while working, not
  just the Prisma schema file)
