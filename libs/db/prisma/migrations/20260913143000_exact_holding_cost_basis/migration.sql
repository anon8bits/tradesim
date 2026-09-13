ALTER TABLE "holdings"
ADD COLUMN "costBasisCents" BIGINT NOT NULL DEFAULT 0;

-- Preserve the best available basis for any pre-existing aggregate holding.
UPDATE "holdings"
SET "costBasisCents" = "avgCostCents" * "quantity";

ALTER TABLE "holdings"
ADD CONSTRAINT "holdings_costBasisCents_nonnegative"
CHECK ("costBasisCents" >= 0);
