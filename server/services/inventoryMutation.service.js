/**
 * server/services/inventoryMutation.service.js
 *
 * PHASE 2A.5: CENTRALIZED INVENTORY MUTATION ENGINE (SSOT)
 *
 * Guarantees:
 * 1. VariantStock is the authoritative single source of truth for stock quantities.
 * 2. Immutable Ledger: Every mutation appends an InventoryMovement record.
 * 3. Mathematical Consistency: quantityAfter = quantityBefore + quantityDelta.
 * 4. Store Locking: acquireStoreInventoryLock is strictly enforced.
 * 5. Idempotency: Duplicate operations with matching (referenceType, referenceId) are replayed safely without double deductions.
 * 6. Dual-Write: Legacy cache (product.stores, product.stock, product.variants) is synchronized inside the same transaction.
 */

const prisma = require('../prisma');
const { acquireStoreInventoryLock, acquireMultiStoreInventoryLocks } = require('./inventoryLock.service');

/**
 * Execute a batch of inventory mutations for a single store inside a Prisma transaction.
 *
 * @param {object} tx - Prisma interactive transaction client
 * @param {object} params
 * @param {string} params.tenantId
 * @param {string} params.storeId
 * @param {string} params.referenceType - 'SALE' | 'RETURN' | 'CANCEL_SALE' | 'PURCHASE' | 'TRANSFER_IN' | 'TRANSFER_OUT' | 'ADJUSTMENT' | 'INITIAL_SYNC'
 * @param {string} params.referenceId - e.g. sale.id, purchase.id, transferRef
 * @param {Array<object>} params.items - [{ productId, variantId, qtyDelta, physicalCount, unitCost, reason, barcode, code }]
 * @param {string} [params.performedBy]
 * @param {string} [params.notes]
 * @param {string} [params.batchId]
 * @param {boolean} [params.skipLock=false] - If caller already acquired the store lock
 * @param {boolean} [params.skipLegacySync=false]
 * @returns {Promise<object>} { success: true, idempotentReplay: boolean, movements: Array, updatedStocks: Array }
 */
async function executeMutation(tx, params) {
    const {
        tenantId,
        storeId,
        referenceType,
        referenceId,
        items,
        performedBy = null,
        notes = null,
        batchId = null,
        skipLock = false,
        skipLegacySync = false
    } = params;

    if (!tenantId) throw new Error('tenantId is required for inventory mutation');
    if (!storeId) throw new Error('storeId is required for inventory mutation');
    if (!referenceType) throw new Error('referenceType is required for inventory mutation');
    if (!referenceId) throw new Error('referenceId is required for inventory mutation');
    if (!Array.isArray(items) || items.length === 0) {
        return { success: true, movements: [], updatedStocks: [], count: 0 };
    }

    // 1. Enforce Store Inventory Lock (Rejects with HTTP 423 if isReconciling)
    if (!skipLock) {
        await acquireStoreInventoryLock(tx, storeId);
    }

    // 2. Operation-Level Idempotency Check
    // If movements for this exact (tenantId, storeId, referenceType, referenceId) already exist,
    // return existing records without duplicate execution.
    const existingMovements = await tx.inventoryMovement.findMany({
        where: {
            tenantId,
            storeId,
            referenceType,
            referenceId: String(referenceId)
        },
        orderBy: { createdAt: 'asc' }
    });

    if (existingMovements.length > 0) {
        return {
            success: true,
            idempotentReplay: true,
            movements: existingMovements,
            count: existingMovements.length
        };
    }

    const recordedMovements = [];
    const recordedStocks = [];

    // 3. Process each line item under row locks
    for (const item of items) {
        // Resolve product
        let product = null;
        if (item.productId) {
            product = await tx.product.findFirst({
                where: { id: item.productId, tenantId }
            });
        }
        if (!product && (item.barcode || item.code)) {
            const codeToSearch = item.barcode || item.code;
            product = await tx.product.findFirst({
                where: { barcode: codeToSearch, tenantId }
            });
        }
        if (!product && (item.variantId || item.barcode || item.code)) {
            // Check candidate products for variant match
            const candidateProducts = await tx.product.findMany({
                where: { tenantId, hasVariants: true }
            });
            product = candidateProducts.find(p =>
                Array.isArray(p.variants) && p.variants.some(v =>
                    (item.variantId && (v.id === item.variantId || v._id === item.variantId)) ||
                    (item.barcode && (v.barcode === item.barcode || v.sku === item.barcode)) ||
                    (item.code && (v.barcode === item.code || v.sku === item.code))
                )
            ) || null;
        }

        if (!product) {
            // If product does not exist, skip
            continue;
        }

        // If product does not track stock, skip mutating inventory
        if (product.trackStock === false) {
            continue;
        }

        // Standardize targetVariantId
        let targetVariantId = null;
        if (item.variantId) {
            targetVariantId = String(item.variantId);
        } else if (product.hasVariants && (item.barcode || item.code)) {
            const codeToSearch = item.barcode || item.code;
            const matchedV = Array.isArray(product.variants)
                ? product.variants.find(v => v.barcode === codeToSearch || v.sku === codeToSearch)
                : null;
            if (matchedV) {
                targetVariantId = String(matchedV.id || matchedV._id);
            }
        }

        // Find existing VariantStock row
        const existingStock = await tx.variantStock.findFirst({
            where: {
                tenantId,
                storeId,
                productId: product.id,
                variantId: targetVariantId
            }
        });

        const currentQuantity = existingStock ? Number(existingStock.quantity) : 0;
        let finalDelta = 0;

        // If physicalCount is provided (e.g. Stock Adjustment), calculate delta dynamically
        if (item.physicalCount !== undefined && item.physicalCount !== null) {
            const physical = Number(item.physicalCount);
            if (isNaN(physical)) throw new Error(`Invalid physical count: ${item.physicalCount}`);
            finalDelta = physical - currentQuantity;
        } else {
            finalDelta = Number(item.qtyDelta !== undefined ? item.qtyDelta : (item.qty || 0));
            if (isNaN(finalDelta)) throw new Error(`Invalid quantity delta: ${item.qtyDelta}`);
        }

        const quantityBefore = currentQuantity;
        const quantityAfter = quantityBefore + finalDelta;

        // 4. Upsert VariantStock
        let updatedStock;
        if (existingStock) {
            updatedStock = await tx.variantStock.update({
                where: { id: existingStock.id },
                data: {
                    quantity: quantityAfter,
                    updatedAt: new Date()
                }
            });
        } else {
            updatedStock = await tx.variantStock.create({
                data: {
                    tenantId,
                    storeId,
                    productId: product.id,
                    variantId: targetVariantId,
                    quantity: quantityAfter
                }
            });
        }
        recordedStocks.push(updatedStock);

        // 5. Create immutable InventoryMovement record
        const movement = await tx.inventoryMovement.create({
            data: {
                tenantId,
                storeId,
                productId: product.id,
                variantId: targetVariantId,
                type: referenceType,
                quantityDelta: finalDelta,
                quantityBefore,
                quantityAfter,
                referenceType,
                referenceId: String(referenceId),
                batchId: batchId || null,
                notes: notes || item.reason || null,
                createdById: performedBy ? String(performedBy) : null
            }
        });
        recordedMovements.push(movement);

        // 6. Dual-Write Legacy Cache Synchronization
        if (!skipLegacySync && product && product.trackStock !== false) {
            // Update stores array
            const stores = Array.isArray(product.stores) ? [...product.stores] : [];
            const storeIdx = stores.findIndex(s => String(s.storeId) === String(storeId));
            if (storeIdx >= 0) {
                stores[storeIdx].stock = (Number(stores[storeIdx].stock) || 0) + finalDelta;
            } else {
                stores.push({ storeId: String(storeId), stock: finalDelta });
            }

            // Update variants array if variantId is matched
            const variants = Array.isArray(product.variants) ? [...product.variants] : [];
            if (targetVariantId && product.hasVariants) {
                const vIdx = variants.findIndex(v => String(v.id) === targetVariantId || String(v._id) === targetVariantId);
                if (vIdx >= 0) {
                    variants[vIdx].stock = (Number(variants[vIdx].stock) || 0) + finalDelta;
                }
            }

            // Recalculate global stock
            const newGlobalStock = stores.reduce((sum, s) => sum + (Number(s.stock) || 0), 0);

            // Calculate weighted average cost if this is a PURCHASE
            let updatedCost = product.cost;
            if (referenceType === 'PURCHASE' && item.unitCost !== undefined && item.unitCost !== null) {
                const oldStock = Math.max(0, quantityBefore);
                const newQty = finalDelta;
                const newCost = Number(item.unitCost) || 0;
                const oldCost = Number(product.cost) || 0;
                if (oldStock + newQty > 0) {
                    updatedCost = ((oldStock * oldCost) + (newQty * newCost)) / (oldStock + newQty);
                } else {
                    updatedCost = newCost;
                }
            }

            await tx.product.update({
                where: { id: product.id },
                data: {
                    stores,
                    variants,
                    stock: newGlobalStock,
                    cost: updatedCost
                }
            });
        }
    }

    return {
        success: true,
        idempotentReplay: false,
        movements: recordedMovements,
        updatedStocks: recordedStocks,
        count: recordedMovements.length
    };
}

/**
 * Record a sale inventory deduction
 */
async function recordSale(tx, { tenantId, storeId, saleId, items, performedBy, notes }) {
    const mutationItems = (items || []).map(item => ({
        productId: item.productId,
        variantId: item.variantId || null,
        qtyDelta: -Math.abs(Number(item.qty || 0)),
        barcode: item.barcode || item.code || null,
        reason: 'Sale'
    }));

    return executeMutation(tx, {
        tenantId,
        storeId,
        referenceType: 'SALE',
        referenceId: saleId,
        items: mutationItems,
        performedBy,
        notes: notes || `Sale: ${saleId}`
    });
}

/**
 * Record a sale return inventory restoration
 */
async function recordReturn(tx, { tenantId, storeId, returnId, saleId, items, performedBy, notes }) {
    const mutationItems = (items || []).map(item => ({
        productId: item.productId,
        variantId: item.variantId || null,
        qtyDelta: Math.abs(Number(item.qty || 0)),
        barcode: item.barcode || item.code || null,
        reason: item.reason || 'Sale Return'
    }));

    return executeMutation(tx, {
        tenantId,
        storeId,
        referenceType: 'RETURN',
        referenceId: returnId || saleId,
        items: mutationItems,
        performedBy,
        notes: notes || `Return for Sale: ${saleId}`
    });
}

/**
 * Record a sale cancellation inventory restoration
 */
async function recordCancelSale(tx, { tenantId, storeId, cancelId, saleId, items, performedBy, notes }) {
    const mutationItems = (items || []).map(item => ({
        productId: item.productId,
        variantId: item.variantId || null,
        qtyDelta: Math.abs(Number(item.qty || 0)),
        barcode: item.barcode || item.code || null,
        reason: item.reason || 'Sale Cancellation'
    }));

    return executeMutation(tx, {
        tenantId,
        storeId,
        referenceType: 'CANCEL_SALE',
        referenceId: cancelId || saleId,
        items: mutationItems,
        performedBy,
        notes: notes || `Cancelled Sale: ${saleId}`
    });
}

/**
 * Record a purchase receiving inventory addition
 */
async function recordPurchase(tx, { tenantId, storeId, purchaseId, items, performedBy, notes }) {
    const mutationItems = (items || []).map(item => ({
        productId: item.productId,
        variantId: item.variantId || null,
        qtyDelta: Math.abs(Number(item.qty || 0)),
        unitCost: item.cost !== undefined ? item.cost : null,
        barcode: item.barcode || item.code || null,
        reason: 'Purchase Receiving'
    }));

    return executeMutation(tx, {
        tenantId,
        storeId,
        referenceType: 'PURCHASE',
        referenceId: purchaseId,
        items: mutationItems,
        performedBy,
        notes: notes || `Purchase: ${purchaseId}`
    });
}

/**
 * Record a stock adjustment
 */
async function recordAdjustment(tx, { tenantId, storeId, adjustmentId, items, performedBy, notes }) {
    const mutationItems = (items || []).map(item => ({
        productId: item.productId,
        variantId: item.variantId || null,
        physicalCount: item.newStock !== undefined ? item.newStock : item.physicalCount,
        reason: item.reason || 'Stock Adjustment'
    }));

    return executeMutation(tx, {
        tenantId,
        storeId,
        referenceType: 'ADJUSTMENT',
        referenceId: adjustmentId,
        items: mutationItems,
        performedBy,
        notes: notes || `Adjustment: ${adjustmentId}`
    });
}

/**
 * Record an atomic stock transfer between two stores
 */
async function recordTransfer(tx, { tenantId, fromStoreId, toStoreId, transferRef, items, performedBy, notes }) {
    if (!fromStoreId || !toStoreId) {
        throw new Error('Both fromStoreId and toStoreId are required for stock transfer');
    }
    if (fromStoreId === toStoreId) {
        throw new Error('Source and destination stores cannot be identical');
    }

    // 1. Acquire multi-store locks in sorted order
    await acquireMultiStoreInventoryLocks(tx, [fromStoreId, toStoreId]);

    // 2. TRANSFER_OUT from source store
    const outItems = (items || []).map(item => ({
        productId: item.productId,
        variantId: item.variantId || null,
        qtyDelta: -Math.abs(Number(item.qty || 0)),
        reason: `Transfer to store ${toStoreId}`
    }));

    const outResult = await executeMutation(tx, {
        tenantId,
        storeId: fromStoreId,
        referenceType: 'TRANSFER_OUT',
        referenceId: transferRef,
        items: outItems,
        performedBy,
        notes: notes || `Transfer OUT: ${transferRef}`,
        skipLock: true
    });

    // 3. TRANSFER_IN to destination store
    const inItems = (items || []).map(item => ({
        productId: item.productId,
        variantId: item.variantId || null,
        qtyDelta: Math.abs(Number(item.qty || 0)),
        reason: `Transfer from store ${fromStoreId}`
    }));

    const inResult = await executeMutation(tx, {
        tenantId,
        storeId: toStoreId,
        referenceType: 'TRANSFER_IN',
        referenceId: transferRef,
        items: inItems,
        performedBy,
        notes: notes || `Transfer IN: ${transferRef}`,
        skipLock: true
    });

    return {
        success: true,
        transferRef,
        outResult,
        inResult
    };
}

module.exports = {
    executeMutation,
    recordSale,
    recordReturn,
    recordCancelSale,
    recordPurchase,
    recordAdjustment,
    recordTransfer
};
