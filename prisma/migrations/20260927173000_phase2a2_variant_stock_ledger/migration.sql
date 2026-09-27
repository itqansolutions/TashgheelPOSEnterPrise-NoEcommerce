-- Phase 2A.2: Schema & Migration ONLY (Non-Destructive)
-- Add variant_stocks and inventory_movements tables without touching any existing data

-- CreateTable: variant_stocks
CREATE TABLE "variant_stocks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "minStock" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "variant_stocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable: inventory_movements
CREATE TABLE "inventory_movements" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "type" TEXT NOT NULL,
    "quantityDelta" DOUBLE PRECISION NOT NULL,
    "quantityBefore" DOUBLE PRECISION NOT NULL,
    "quantityAfter" DOUBLE PRECISION NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "batchId" TEXT,
    "isReversal" BOOLEAN NOT NULL DEFAULT false,
    "reversalOfId" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: variant_stocks
CREATE INDEX "variant_stocks_tenantId_storeId_idx" ON "variant_stocks"("tenantId", "storeId");
CREATE INDEX "variant_stocks_tenantId_productId_idx" ON "variant_stocks"("tenantId", "productId");
CREATE INDEX "variant_stocks_tenantId_variantId_idx" ON "variant_stocks"("tenantId", "variantId");
CREATE UNIQUE INDEX "variant_stocks_tenantId_variantId_storeId_key" ON "variant_stocks"("tenantId", "variantId", "storeId");

-- CreateIndex: inventory_movements
CREATE INDEX "inventory_movements_tenantId_storeId_createdAt_idx" ON "inventory_movements"("tenantId", "storeId", "createdAt");
CREATE INDEX "inventory_movements_tenantId_productId_variantId_idx" ON "inventory_movements"("tenantId", "productId", "variantId");
CREATE INDEX "inventory_movements_referenceType_referenceId_idx" ON "inventory_movements"("referenceType", "referenceId");
CREATE INDEX "inventory_movements_batchId_idx" ON "inventory_movements"("batchId");

-- AddForeignKey: variant_stocks
ALTER TABLE "variant_stocks" ADD CONSTRAINT "variant_stocks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "variant_stocks" ADD CONSTRAINT "variant_stocks_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "variant_stocks" ADD CONSTRAINT "variant_stocks_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: inventory_movements
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
