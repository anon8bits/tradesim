import { PrismaClient } from "@prisma/client";

// A single shared PrismaClient instance per process. NestJS apps should wrap
// this in an injectable PrismaService (added in Phase 2); the worker can use
// this export directly.
export const prisma = new PrismaClient();

export * from "@prisma/client";
