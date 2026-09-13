-- Persist enough delivery state to retry post-commit Redis publication.
ALTER TABLE "orders"
ADD COLUMN "rejectionReason" TEXT,
ADD COLUMN "eventPublishedAt" TIMESTAMP(3);

-- Defense in depth: malformed rows must not invert financial arithmetic even
-- if they are inserted outside the validated HTTP API.
ALTER TABLE "users"
ADD CONSTRAINT "users_cashBalanceCents_nonnegative"
CHECK ("cashBalanceCents" >= 0);

ALTER TABLE "holdings"
ADD CONSTRAINT "holdings_quantity_nonnegative"
CHECK ("quantity" >= 0),
ADD CONSTRAINT "holdings_avgCostCents_nonnegative"
CHECK ("avgCostCents" >= 0);

ALTER TABLE "orders"
ADD CONSTRAINT "orders_quantity_positive"
CHECK ("quantity" > 0),
ADD CONSTRAINT "orders_fillPriceCents_positive"
CHECK ("fillPriceCents" IS NULL OR "fillPriceCents" > 0);

ALTER TABLE "price_snapshots"
ADD CONSTRAINT "price_snapshots_priceCents_positive"
CHECK ("priceCents" > 0);
