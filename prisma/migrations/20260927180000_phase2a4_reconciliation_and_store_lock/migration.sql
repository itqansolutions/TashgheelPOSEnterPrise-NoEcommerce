-- ==============================================================================
-- PHASE 2A.4 MIGRATION: OPENING RECONCILIATION ENGINE & STORE LOCKING
-- Non-destructive, additive schema migration
-- ==============================================================================

-- 1. Add Store Locking Columns to "stores" table
ALTER TABLE "stores" 
ADD COLUMN IF NOT EXISTS "isReconciling" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "activeReconciliationId" TEXT;

-- 2. Create "opening_reconciliation_sessions" table
CREATE TABLE IF NOT EXISTS "opening_reconciliation_sessions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "batchId" TEXT,
    "initiatedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "approvingStartedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opening_reconciliation_sessions_pkey" PRIMARY KEY ("id")
);

-- 3. Create "opening_reconciliation_items" table
CREATE TABLE IF NOT EXISTS "opening_reconciliation_items" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "legacyQtySnapshot" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "physicalCount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "variance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "costPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "exceptionFlag" TEXT NOT NULL DEFAULT 'NONE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opening_reconciliation_items_pkey" PRIMARY KEY ("id")
);

-- 4. Standard Constraints & Indexes
CREATE UNIQUE INDEX IF NOT EXISTS "opening_reconciliation_sessions_batchId_key" 
ON "opening_reconciliation_sessions"("batchId");

CREATE INDEX IF NOT EXISTS "opening_reconciliation_sessions_tenantId_storeId_status_idx" 
ON "opening_reconciliation_sessions"("tenantId", "storeId", "status");

CREATE INDEX IF NOT EXISTS "opening_reconciliation_items_sessionId_idx" 
ON "opening_reconciliation_items"("sessionId");

CREATE INDEX IF NOT EXISTS "opening_reconciliation_items_productId_variantId_idx" 
ON "opening_reconciliation_items"("productId", "variantId");

-- 5. Foreign Key Relations
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'opening_reconciliation_sessions_tenantId_fkey'
    ) THEN
        ALTER TABLE "opening_reconciliation_sessions" 
        ADD CONSTRAINT "opening_reconciliation_sessions_tenantId_fkey" 
        FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'opening_reconciliation_sessions_storeId_fkey'
    ) THEN
        ALTER TABLE "opening_reconciliation_sessions" 
        ADD CONSTRAINT "opening_reconciliation_sessions_storeId_fkey" 
        FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'opening_reconciliation_items_sessionId_fkey'
    ) THEN
        ALTER TABLE "opening_reconciliation_items" 
        ADD CONSTRAINT "opening_reconciliation_items_sessionId_fkey" 
        FOREIGN KEY ("sessionId") REFERENCES "opening_reconciliation_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'opening_reconciliation_items_productId_fkey'
    ) THEN
        ALTER TABLE "opening_reconciliation_items" 
        ADD CONSTRAINT "opening_reconciliation_items_productId_fkey" 
        FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- 6. CRITICAL POSTGRESQL PARTIAL UNIQUE INDEXES (Guaranteed DB-Enforced Rules)
-- 6.1 Strict Single-Active-Session Constraint per (Tenant + Store)
CREATE UNIQUE INDEX IF NOT EXISTS "unique_active_reconciliation_per_store" 
ON "opening_reconciliation_sessions" ("tenantId", "storeId") 
WHERE "status" IN ('IN_PROGRESS', 'READY_FOR_REVIEW', 'APPROVING');

-- 6.2 Standard Product Uniqueness within Session (variantId IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS "unique_session_standard_product" 
ON "opening_reconciliation_items" ("sessionId", "productId") 
WHERE "variantId" IS NULL;

-- 6.3 Variant Product Uniqueness within Session (variantId IS NOT NULL)
CREATE UNIQUE INDEX IF NOT EXISTS "unique_session_variant_product" 
ON "opening_reconciliation_items" ("sessionId", "productId", "variantId") 
WHERE "variantId" IS NOT NULL;

-- 7. VARIANT_STOCKS DUAL PARTIAL UNIQUE INDEXES (Guaranteed Standard Product & Variant Uniqueness)
-- 7.1 Allow nullable variantId in variant_stocks for Standard Products
ALTER TABLE "variant_stocks" ALTER COLUMN "variantId" DROP NOT NULL;

-- 7.2 Drop naive composite unique key if exists
DROP INDEX IF EXISTS "variant_stocks_tenantId_variantId_storeId_key";

-- 7.3 Standard Product Uniqueness in VariantStock (variantId IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS "unique_variant_stock_standard" 
ON "variant_stocks" ("tenantId", "storeId", "productId") 
WHERE "variantId" IS NULL;

-- 7.4 Variant Product Uniqueness in VariantStock (variantId IS NOT NULL)
CREATE UNIQUE INDEX IF NOT EXISTS "unique_variant_stock_variant" 
ON "variant_stocks" ("tenantId", "storeId", "variantId") 
WHERE "variantId" IS NOT NULL;
