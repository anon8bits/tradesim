# Copilot instructions

Read `/AGENTS.md` for full project context (stack, architecture, conventions,
current task status) before generating code.

Quick reference:
- Backend: NestJS + TypeScript, Prisma/PostgreSQL, Redis + BullMQ, Auth0.
- Order execution must always happen inside a single DB transaction with a
  row-level lock — never split checks and writes across separate queries.
- Write tests for anything touching balances, holdings, or orders.
- Build/test commands: `pnpm install`, `pnpm dev`, `pnpm test`, `pnpm lint`.
- See `docs/ARCHITECTURE.md` for diagrams and `docs/DECISIONS.md` before
  suggesting a different framework, database, or queue technology.
