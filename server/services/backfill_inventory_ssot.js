/**
 * server/services/backfill_inventory_ssot.js
 *
 * PHASE 2A.5: IDEMPOTENT BACKFILL SCRIPT
 *
 * Migrates existing inventory from legacy fields (product.stores / variant.stock)
 * into VariantStock and creates an INITIAL_SYNC ledger entry in InventoryMovement.
 *
 * Rules:
 * 1. Standard Products: VariantStock = product.stores[storeId].stock (variantId = null).
 * 2. Single-Store Variable Products: VariantStock = variant.stock (variantId = variant.id).
 * 3. Multi-Store Variable Products: VariantStock = 0 (Flagged for Opening Reconciliation).
 * 4. Idempotency: referenceId is deterministic (INIT_${tenantId}_${storeId}_${productId}_${variantId || 'STD'}).
 *    If VariantStock or Movement already exists, it is completely skipped.
 * 5. Dry-run mode produces a full telemetry report without touching DB.
 */

require('dotenv').config();
const prisma = require('../prisma');

async function runBackfill({ dryRun = true } = {}) {
    const report = {
        dryRun,
        tenantsProcessed: 0,
        storesProcessed: 0,
        productsExamined: 0,
        standardProducts: 0,
        variableProducts: 0,
        totalVariants: 0,
        rowsToCreate: 0,
        rowsToSkip: 0,
        conflicts: 0,
        totalOpeningQuantity: 0,
        standardEntriesToCreate: 0,
        singleStoreVariantEntriesToCreate: 0,
        multiStoreVariantEntriesToCreate: 0,
        skippedExistingEntries: 0,
        createdMovements: 0,
        errors: []
    };

    console.log(`\n======================================================`);
    console.log(`  STARTING INVENTORY SSOT BACKFILL (${dryRun ? 'DRY-RUN' : 'APPLY MODE'})`);
    console.log(`======================================================\n`);

    try {
        const tenants = await prisma.tenant.findMany({
            include: { stores: true }
        });
        report.tenantsProcessed = tenants.length;

        for (const tenant of tenants) {
            const tenantStores = tenant.stores || [];
            if (tenantStores.length === 0) continue;

            const isSingleStore = tenantStores.length === 1;

            const products = await prisma.product.findMany({
                where: { tenantId: tenant.id }
            });
            report.productsExamined += products.length;

            for (const product of products) {
                const hasVariants = product.hasVariants && Array.isArray(product.variants) && product.variants.length > 0;
                if (hasVariants) {
                    report.variableProducts++;
                    report.totalVariants += product.variants.length;
                } else {
                    report.standardProducts++;
                }
            }

            for (const store of tenantStores) {
                report.storesProcessed++;

                for (const product of products) {
                    if (product.trackStock === false) continue;

                    const hasVariants = product.hasVariants && Array.isArray(product.variants) && product.variants.length > 0;

                    if (!hasVariants) {
                        // Standard Product
                        const storesArr = Array.isArray(product.stores) ? product.stores : [];
                        const storeData = storesArr.find(s => String(s.storeId) === String(store.id));
                        const currentStock = storeData ? (Number(storeData.stock) || 0) : 0;

                        // Check if VariantStock already exists
                        const existing = await prisma.variantStock.findFirst({
                            where: {
                                tenantId: tenant.id,
                                storeId: store.id,
                                productId: product.id,
                                variantId: null
                            }
                        });

                        if (existing) {
                            report.skippedExistingEntries++;
                            report.rowsToSkip++;
                        } else {
                            report.standardEntriesToCreate++;
                            report.rowsToCreate++;
                            report.totalOpeningQuantity += currentStock;
                            if (!dryRun) {
                                await prisma.$transaction(async (tx) => {
                                    await tx.variantStock.create({
                                        data: {
                                            tenantId: tenant.id,
                                            storeId: store.id,
                                            productId: product.id,
                                            variantId: null,
                                            quantity: currentStock
                                        }
                                    });

                                    if (currentStock !== 0) {
                                        await tx.inventoryMovement.create({
                                            data: {
                                                tenantId: tenant.id,
                                                storeId: store.id,
                                                productId: product.id,
                                                variantId: null,
                                                type: 'INITIAL_SYNC',
                                                quantityDelta: currentStock,
                                                quantityBefore: 0,
                                                quantityAfter: currentStock,
                                                referenceType: 'INITIAL_SYNC',
                                                referenceId: `INIT_${tenant.id}_${store.id}_${product.id}_STD`,
                                                batchId: 'BACKFILL_PHASE2A5_V1',
                                                notes: 'Initial Backfill from Legacy Store Stock'
                                            }
                                        });
                                        report.createdMovements++;
                                    }
                                });
                            }
                        }
                    } else {
                        // Variable Product
                        for (const variant of product.variants) {
                            const variantId = String(variant.id || variant._id);

                            const existing = await prisma.variantStock.findFirst({
                                where: {
                                    tenantId: tenant.id,
                                    storeId: store.id,
                                    productId: product.id,
                                    variantId
                                }
                            });

                            if (existing) {
                                report.skippedExistingEntries++;
                                report.rowsToSkip++;
                                continue;
                            }

                            report.rowsToCreate++;

                            if (isSingleStore) {
                                // Single-store tenant: map directly from variant.stock
                                const vStock = Number(variant.stock) || 0;
                                report.singleStoreVariantEntriesToCreate++;
                                report.totalOpeningQuantity += vStock;

                                if (!dryRun) {
                                    await prisma.$transaction(async (tx) => {
                                        await tx.variantStock.create({
                                            data: {
                                                tenantId: tenant.id,
                                                storeId: store.id,
                                                productId: product.id,
                                                variantId,
                                                quantity: vStock
                                            }
                                        });

                                        if (vStock !== 0) {
                                            await tx.inventoryMovement.create({
                                                data: {
                                                    tenantId: tenant.id,
                                                    storeId: store.id,
                                                    productId: product.id,
                                                    variantId,
                                                    type: 'INITIAL_SYNC',
                                                    quantityDelta: vStock,
                                                    quantityBefore: 0,
                                                    quantityAfter: vStock,
                                                    referenceType: 'INITIAL_SYNC',
                                                    referenceId: `INIT_${tenant.id}_${store.id}_${product.id}_${variantId}`,
                                                    batchId: 'BACKFILL_PHASE2A5_V1',
                                                    notes: 'Initial Backfill from Single-Store Variant Stock'
                                                }
                                            });
                                            report.createdMovements++;
                                        }
                                    });
                                }
                            } else {
                                // Multi-store tenant: set to 0 to prevent fictional distribution
                                report.multiStoreVariantEntriesToCreate++;

                                if (!dryRun) {
                                    await prisma.variantStock.create({
                                        data: {
                                            tenantId: tenant.id,
                                            storeId: store.id,
                                            productId: product.id,
                                            variantId,
                                            quantity: 0
                                        }
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }

        console.log(`\n======================================================`);
        console.log(`  BACKFILL TELEMETRY REPORT (${dryRun ? 'DRY-RUN (READ-ONLY)' : 'APPLY COMPLETE'})`);
        console.log(`======================================================`);
        console.log(`Tenants:                                ${report.tenantsProcessed}`);
        console.log(`Stores:                                 ${report.storesProcessed}`);
        console.log(`Products Examined:                      ${report.productsExamined}`);
        console.log(`  - Standard Products:                  ${report.standardProducts}`);
        console.log(`  - Variable Products:                  ${report.variableProducts}`);
        console.log(`  - Total Variants:                     ${report.totalVariants}`);
        console.log(`Rows to Create:                         ${report.rowsToCreate}`);
        console.log(`  - Standard Product Stocks:            ${report.standardEntriesToCreate}`);
        console.log(`  - Single-Store Variant Stocks:        ${report.singleStoreVariantEntriesToCreate}`);
        console.log(`  - Multi-Store Variant Stocks (Init 0): ${report.multiStoreVariantEntriesToCreate}`);
        console.log(`Rows to Skip (Already Exist):           ${report.rowsToSkip}`);
        console.log(`Conflicts / Exceptions:                 ${report.conflicts}`);
        console.log(`Total Opening Quantity:                 ${report.totalOpeningQuantity}`);
        if (!dryRun) {
            console.log(`Created Initial Movements:             ${report.createdMovements}`);
        }
        console.log(`======================================================\n`);

        return report;
    } catch (err) {
        console.error('Backfill Error:', err);
        report.errors.push(err.message);
        throw err;
    }
}

if (require.main === module) {
    const isApply = process.argv.includes('--apply');
    runBackfill({ dryRun: !isApply })
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
}

module.exports = { runBackfill };
