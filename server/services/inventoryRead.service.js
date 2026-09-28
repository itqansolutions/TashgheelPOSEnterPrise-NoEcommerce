/**
 * server/services/inventoryRead.service.js
 *
 * PHASE 2A.6: CENTRALIZED INVENTORY READ SERVICE
 *
 * Authoritative Single Read Layer for all inventory balances, store stocks,
 * available quantities, inventory valuations, KPI summaries, and Variant x Store matrices.
 *
 * Rules:
 * 1. VariantStock is the sole authoritative SSOT.
 * 2. Zero silent fallback to legacy fields (product.stores, product.stock, variant.stock).
 *    If no VariantStock record exists, the stock is strictly 0.
 * 3. Cost calculation adheres strictly to:
 *    - Standard: VariantStock.quantity * Product.cost
 *    - Variable: VariantStock.quantity * (Variant.cost ?? Product.cost)
 * 4. Currency is dynamically resolved from Tenant settings.
 */

const prisma = require('../prisma');
const { resolveVariant, getCanonicalVariantId, getVariantCandidateIds } = require('./variantResolver');

/**
 * Helper to get the start of the current day (UTC/Local)
 */
function getStartOfDay() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
}

/**
 * 1. Get Store Inventory
 * Authoritative inventory list for a specific store.
 */
async function getStoreInventory(tenantId, storeId, options = {}, txPrisma = null) {
    if (!tenantId || !storeId) {
        throw new Error('tenantId and storeId are required to get store inventory');
    }

    const db = txPrisma || prisma;
    const { search = '', category = '', lowStockOnly = false } = options;

    // 1. Fetch store info
    const store = await db.store.findFirst({
        where: { id: String(storeId), tenantId }
    });
    if (!store) {
        const notFound = new Error('Store not found');
        notFound.statusCode = 404;
        throw notFound;
    }

    // 2. Fetch all tracked products for this tenant
    const whereProduct = {
        tenantId,
        active: true,
        trackStock: true
    };

    if (category) {
        whereProduct.category = category;
    }

    if (search) {
        whereProduct.OR = [
            { name: { contains: search, mode: 'insensitive' } },
            { barcode: { contains: search, mode: 'insensitive' } }
        ];
    }

    const products = await db.product.findMany({
        where: whereProduct,
        orderBy: { name: 'asc' }
    });

    // 3. Fetch all VariantStock rows for this store
    const variantStocks = await db.variantStock.findMany({
        where: {
            tenantId,
            storeId: String(storeId)
        }
    });

    // Index variant stocks by "productId_variantId"
    const stockMap = new Map();
    for (const vs of variantStocks) {
        const key = `${vs.productId}_${vs.variantId || 'STD'}`;
        stockMap.set(key, vs);
    }

    // 4. Fetch the latest movement for each product/variant in this store
    const latestMovements = await db.inventoryMovement.findMany({
        where: {
            tenantId,
            storeId: String(storeId)
        },
        orderBy: { createdAt: 'desc' },
        distinct: ['productId', 'variantId']
    });

    const movementMap = new Map();
    for (const lm of latestMovements) {
        const key = `${lm.productId}_${lm.variantId || 'STD'}`;
        movementMap.set(key, {
            type: lm.type,
            quantityDelta: lm.quantityDelta,
            createdAt: lm.createdAt
        });
    }

    // 5. Build structured inventory items
    const items = [];

    for (const prod of products) {
        const hasVariants = prod.hasVariants && Array.isArray(prod.variants) && prod.variants.length > 0;

        if (hasVariants) {
            for (const v of prod.variants) {
                const candidateKeys = [v.id, v._id, v.sku, v.barcode].filter(Boolean).map(String);
                let vs = null;
                let matchedKey = null;
                for (const ck of candidateKeys) {
                    const k = `${prod.id}_${ck}`;
                    if (stockMap.has(k)) {
                        vs = stockMap.get(k);
                        matchedKey = k;
                        break;
                    }
                }

                const quantity = vs ? Number(vs.quantity) : 0;
                const minStock = vs ? Number(vs.minStock) : Number(prod.minStock || 0);
                const unitCost = (v.cost !== undefined && v.cost !== null && !isNaN(v.cost))
                    ? Number(v.cost)
                    : Number(prod.cost || 0);

                let status = 'IN_STOCK';
                if (quantity <= 0) {
                    status = 'OUT_OF_STOCK';
                } else if (minStock > 0 && quantity <= minStock) {
                    status = 'LOW_STOCK';
                }

                if (lowStockOnly && status === 'IN_STOCK') {
                    continue;
                }

                const variantIdCanonical = String(v.id || v._id || v.sku || v.barcode || '');
                const variantLabel = v.name || (v.attributes ? Object.values(v.attributes).join(' / ') : null) || v.sku || variantIdCanonical;

                items.push({
                    productId: prod.id,
                    productName: prod.name,
                    productNameEn: prod.nameEn || prod.name,
                    category: prod.category || 'Uncategorized',
                    hasVariants: true,
                    variantId: variantIdCanonical,
                    variantName: variantLabel,
                    barcode: v.barcode || v.sku || prod.barcode || '',
                    price: Number(v.price || prod.price || 0),
                    cost: unitCost,
                    quantity,
                    minStock,
                    status,
                    lastMovement: (matchedKey && movementMap.get(matchedKey)) || movementMap.get(`${prod.id}_${v.id}`) || null,
                    updatedAt: vs?.updatedAt || null
                });
            }
        } else {
            // Standard Product
            const key = `${prod.id}_STD`;
            const vs = stockMap.get(key);
            const quantity = vs ? Number(vs.quantity) : 0;
            const minStock = vs ? Number(vs.minStock) : Number(prod.minStock || 0);
            const unitCost = Number(prod.cost || 0);

            let status = 'IN_STOCK';
            if (quantity <= 0) {
                status = 'OUT_OF_STOCK';
            } else if (minStock > 0 && quantity <= minStock) {
                status = 'LOW_STOCK';
            }

            if (lowStockOnly && status === 'IN_STOCK') {
                continue;
            }

            items.push({
                productId: prod.id,
                productName: prod.name,
                productNameEn: prod.nameEn || prod.name,
                category: prod.category || 'Uncategorized',
                hasVariants: false,
                variantId: null,
                variantName: null,
                barcode: prod.barcode || '',
                price: Number(prod.price || 0),
                cost: unitCost,
                quantity,
                minStock,
                status,
                lastMovement: movementMap.get(key) || null,
                updatedAt: vs?.updatedAt || null
            });
        }
    }

    return {
        store: {
            id: store.id,
            name: store.name,
            location: store.location,
            isReconciling: store.isReconciling,
            activeReconciliationId: store.activeReconciliationId
        },
        items,
        totalItems: items.length
    };
}

/**
 * 2. Get Available Quantity
 * Strict, real-time available stock lookup for a single product/variant in a specific store.
 */
async function getAvailableQuantity(tenantId, storeId, productId, variantId = null, txPrisma = null) {
    if (!tenantId || !storeId || !productId) {
        return { availableQuantity: 0, isTracked: false, storeLocked: false };
    }

    const db = txPrisma || prisma;

    const [store, product] = await Promise.all([
        db.store.findFirst({
            where: { id: String(storeId), tenantId },
            select: { isReconciling: true, activeReconciliationId: true }
        }),
        db.product.findFirst({
            where: { id: String(productId), tenantId },
            select: { trackStock: true, hasVariants: true, variants: true }
        })
    ]);

    let variantStock = null;
    if (variantId) {
        let matched = null;
        if (product?.hasVariants && Array.isArray(product.variants)) {
            matched = resolveVariant(product.variants, variantId, {
                productId: product.id,
                productName: product.name
            });
        }
        const canonicalId = matched ? getCanonicalVariantId(matched) : String(variantId);
        variantStock = await db.variantStock.findFirst({
            where: {
                tenantId,
                storeId: String(storeId),
                productId: String(productId),
                variantId: canonicalId
            },
            select: { quantity: true, minStock: true }
        });

        const candidateIds = getVariantCandidateIds(matched, variantId);
        if (!variantStock && candidateIds.length > 1) {
            variantStock = await db.variantStock.findFirst({
                where: {
                    tenantId,
                    storeId: String(storeId),
                    productId: String(productId),
                    variantId: { in: candidateIds }
                },
                select: { quantity: true, minStock: true }
            });
        }
    } else {
        variantStock = await db.variantStock.findFirst({
            where: {
                tenantId,
                storeId: String(storeId),
                productId: String(productId),
                variantId: null
            },
            select: { quantity: true, minStock: true }
        });
    }

    const isTracked = product?.trackStock !== false;
    const storeLocked = Boolean(store?.isReconciling);
    const quantity = isTracked && variantStock ? Number(variantStock.quantity) : 0;

    return {
        availableQuantity: quantity,
        isTracked,
        storeLocked,
        minStock: variantStock ? Number(variantStock.minStock) : 0
    };
}

/**
 * 3. Get Inventory KPIs
 * High-level executive KPI cards for Dashboard and Inventory header.
 */
async function getInventoryKPIs(tenantId, storeId = null, txPrisma = null) {
    if (!tenantId) throw new Error('tenantId is required');

    const db = txPrisma || prisma;

    const [tenant, store] = await Promise.all([
        db.tenant.findUnique({
            where: { id: tenantId },
            select: { shopName: true, taxName: true }
        }),
        storeId ? db.store.findFirst({
            where: { id: String(storeId), tenantId },
            select: { id: true, name: true, isReconciling: true }
        }) : null
    ]);

    const whereStock = {
        tenantId,
        ...(storeId && { storeId: String(storeId) })
    };

    const variantStocks = await db.variantStock.findMany({
        where: whereStock,
        include: {
            product: {
                select: {
                    id: true,
                    cost: true,
                    variants: true,
                    hasVariants: true,
                    trackStock: true
                }
            }
        }
    });

    let totalUnits = 0;
    let totalValuation = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;

    for (const vs of variantStocks) {
        if (vs.product?.trackStock === false) continue;

        const qty = Number(vs.quantity || 0);
        const min = Number(vs.minStock || 0);

        totalUnits += qty;

        // Resolve unit cost strictly
        let unitCost = Number(vs.product?.cost || 0);
        if (vs.product?.hasVariants && vs.variantId && Array.isArray(vs.product.variants)) {
            const variantObj = vs.product.variants.find(v => String(v.id) === String(vs.variantId));
            if (variantObj && variantObj.cost !== undefined && variantObj.cost !== null && !isNaN(variantObj.cost)) {
                unitCost = Number(variantObj.cost);
            }
        }

        totalValuation += (qty * unitCost);

        if (qty <= 0) {
            outOfStockCount++;
        } else if (min > 0 && qty <= min) {
            lowStockCount++;
        }
    }

    // Today's Movements count
    const startOfDay = getStartOfDay();
    const todayMovementsCount = await db.inventoryMovement.count({
        where: {
            tenantId,
            ...(storeId && { storeId: String(storeId) }),
            createdAt: { gte: startOfDay }
        }
    });

    return {
        totalUnits: Math.round(totalUnits * 100) / 100,
        totalValuation: Math.round(totalValuation * 100) / 100,
        lowStockCount,
        outOfStockCount,
        todayMovementsCount,
        currency: tenant?.taxName?.includes('SAR') ? 'SAR' : 'EGP',
        store: store ? { id: store.id, name: store.name, isReconciling: store.isReconciling } : null
    };
}

/**
 * 4. Get Product Store Matrix
 * 2D matrix of Variant x Store inventory with grand totals and movement drill-down support.
 */
async function getProductStoreMatrix(tenantId, productId, txPrisma = null) {
    if (!tenantId || !productId) throw new Error('tenantId and productId are required');

    const db = txPrisma || prisma;

    const [product, stores, variantStocks] = await Promise.all([
        db.product.findFirst({
            where: { id: String(productId), tenantId }
        }),
        db.store.findMany({
            where: { tenantId },
            orderBy: { name: 'asc' },
            select: { id: true, name: true, location: true, isReconciling: true, activeReconciliationId: true }
        }),
        db.variantStock.findMany({
            where: { productId: String(productId), tenantId }
        })
    ]);

    if (!product) {
        const notFound = new Error('Product not found');
        notFound.statusCode = 404;
        throw notFound;
    }

    const hasVariants = product.hasVariants && Array.isArray(product.variants) && product.variants.length > 0;

    // Map stocks: `${variantId || 'STD'}_${storeId}` -> quantity
    const stockMap = new Map();
    for (const vs of variantStocks) {
        const key = `${vs.variantId || 'STD'}_${vs.storeId}`;
        stockMap.set(key, Number(vs.quantity || 0));
    }

    const rows = [];
    const storeTotals = {};
    for (const s of stores) {
        storeTotals[s.id] = 0;
    }
    let grandTotal = 0;

    if (hasVariants) {
        for (const v of product.variants) {
            const storeStocks = {};
            let variantTotal = 0;
            const candidateKeys = [v.id, v._id, v.sku, v.barcode].filter(Boolean).map(String);

            for (const s of stores) {
                let qty = 0;
                for (const ck of candidateKeys) {
                    const k = `${ck}_${s.id}`;
                    if (stockMap.has(k)) {
                        qty = stockMap.get(k);
                        break;
                    }
                }
                storeStocks[s.id] = qty;
                variantTotal += qty;
                storeTotals[s.id] += qty;
                grandTotal += qty;
            }

            const variantIdCanonical = String(v.id || v._id || v.sku || v.barcode || '');
            const variantLabel = v.name || (v.attributes ? Object.values(v.attributes).join(' / ') : null) || v.sku || variantIdCanonical;

            rows.push({
                variantId: variantIdCanonical,
                label: variantLabel,
                barcode: v.barcode || v.sku || product.barcode || '',
                cost: v.cost !== undefined ? Number(v.cost) : Number(product.cost || 0),
                price: v.price !== undefined ? Number(v.price) : Number(product.price || 0),
                storeStocks,
                totalQty: variantTotal
            });
        }
    } else {
        // Standard Product
        const storeStocks = {};
        let standardTotal = 0;

        for (const s of stores) {
            const key = `STD_${s.id}`;
            const qty = stockMap.get(key) || 0;
            storeStocks[s.id] = qty;
            standardTotal += qty;
            storeTotals[s.id] += qty;
            grandTotal += qty;
        }

        rows.push({
            variantId: null,
            label: '(Standard)',
            barcode: product.barcode || '',
            cost: Number(product.cost || 0),
            price: Number(product.price || 0),
            storeStocks,
            totalQty: standardTotal
        });
    }

    return {
        product: {
            id: product.id,
            name: product.name,
            nameEn: product.nameEn,
            barcode: product.barcode,
            category: product.category,
            hasVariants
        },
        stores,
        rows,
        matrix: rows.map(r => ({
            variantId: r.variantId,
            label: r.label,
            stores: r.storeStocks,
            rowTotal: r.totalQty
        })),
        storeTotals,
        grandTotal
    };
}

/**
 * 5. Get Variant Movement History
 * Returns recent movements for a specific Variant and Store (Drill-Down from Matrix)
 */
async function getVariantMovementHistory(tenantId, storeId, productId, variantId = null, limit = 10, txPrisma = null) {
    if (!tenantId || !storeId || !productId) {
        throw new Error('tenantId, storeId, and productId are required');
    }

    const db = txPrisma || prisma;

    const movements = await db.inventoryMovement.findMany({
        where: {
            tenantId,
            storeId: String(storeId),
            productId: String(productId),
            variantId: variantId ? String(variantId) : null
        },
        orderBy: { createdAt: 'desc' },
        take: Math.min(50, Math.max(1, limit)),
        include: {
            store: { select: { id: true, name: true } },
            product: { select: { id: true, name: true } }
        }
    });

    const currentStock = await db.variantStock.findFirst({
        where: {
            tenantId,
            storeId: String(storeId),
            productId: String(productId),
            variantId: variantId ? String(variantId) : null
        }
    });

    return {
        currentStock: currentStock ? Number(currentStock.quantity) : 0,
        movements: movements.map(m => ({
            id: m.id,
            type: m.type,
            quantityBefore: m.quantityBefore,
            quantityDelta: m.quantityDelta,
            quantityAfter: m.quantityAfter,
            referenceType: m.referenceType,
            referenceId: m.referenceId,
            notes: m.notes,
            createdAt: m.createdAt
        }))
    };
}

/**
 * 6. Get Movements Ledger
 * Full paginated ledger with multi-criteria filtering
 */
async function getMovementsLedger(tenantId, options = {}, txPrisma = null) {
    if (!tenantId) throw new Error('tenantId is required');

    const db = txPrisma || prisma;

    const {
        storeId,
        productId,
        variantId,
        movementType,
        startDate,
        endDate,
        page = 1,
        limit = 50
    } = options;

    const take = Math.min(100, Math.max(1, parseInt(limit) || 50));
    const skip = (Math.max(1, parseInt(page) || 1) - 1) * take;

    const where = {
        tenantId,
        ...(storeId && { storeId: String(storeId) }),
        ...(productId && { productId: String(productId) }),
        ...(variantId && { variantId: String(variantId) }),
        ...(movementType && { type: String(movementType) }),
        ...(startDate || endDate ? {
            createdAt: {
                ...(startDate && { gte: new Date(startDate) }),
                ...(endDate && { lte: new Date(endDate) })
            }
        } : {})
    };

    const [movements, total] = await Promise.all([
        db.inventoryMovement.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take,
            skip,
            include: {
                product: { select: { id: true, name: true, barcode: true } },
                store: { select: { id: true, name: true } }
            }
        }),
        db.inventoryMovement.count({ where })
    ]);

    return {
        movements,
        total,
        page: parseInt(page) || 1,
        limit: take,
        totalPages: Math.ceil(total / take)
    };
}

/**
 * 7. Get Inventory Valuation
 * Full valuation analysis grouped by store and category.
 */
async function getInventoryValuation(tenantId, storeId = null, txPrisma = null) {
    if (!tenantId) throw new Error('tenantId is required');

    const db = txPrisma || prisma;

    const [tenant, stores] = await Promise.all([
        db.tenant.findUnique({
            where: { id: tenantId },
            select: { shopName: true, taxName: true }
        }),
        db.store.findMany({
            where: { tenantId, ...(storeId && { id: String(storeId) }) },
            select: { id: true, name: true }
        })
    ]);

    const variantStocks = await db.variantStock.findMany({
        where: {
            tenantId,
            ...(storeId && { storeId: String(storeId) })
        },
        include: {
            product: {
                select: {
                    id: true,
                    name: true,
                    barcode: true,
                    category: true,
                    cost: true,
                    price: true,
                    hasVariants: true,
                    variants: true
                }
            },
            store: {
                select: { id: true, name: true }
            }
        }
    });

    const breakdown = [];
    let grandTotalUnits = 0;
    let grandTotalValuation = 0;
    let grandTotalRetailValue = 0;

    for (const vs of variantStocks) {
        const prod = vs.product;
        if (!prod) continue;

        const qty = Number(vs.quantity || 0);
        let unitCost = Number(prod.cost || 0);
        let unitPrice = Number(prod.price || 0);
        let variantName = null;

        if (prod.hasVariants && vs.variantId && Array.isArray(prod.variants)) {
            const v = prod.variants.find(item => String(item.id) === String(vs.variantId));
            if (v) {
                variantName = v.name || v.id;
                if (v.cost !== undefined && v.cost !== null && !isNaN(v.cost)) unitCost = Number(v.cost);
                if (v.price !== undefined && v.price !== null && !isNaN(v.price)) unitPrice = Number(v.price);
            }
        }

        const totalCostValue = Math.round(qty * unitCost * 100) / 100;
        const totalRetailValue = Math.round(qty * unitPrice * 100) / 100;

        grandTotalUnits += qty;
        grandTotalValuation += totalCostValue;
        grandTotalRetailValue += totalRetailValue;

        breakdown.push({
            storeId: vs.storeId,
            storeName: vs.store?.name || vs.storeId,
            productId: prod.id,
            productName: prod.name,
            variantId: vs.variantId,
            variantName,
            category: prod.category || 'General',
            quantity: qty,
            unitCost,
            unitPrice,
            totalCostValue,
            totalValuation: totalCostValue,
            totalRetailValue,
            potentialProfit: Math.round((totalRetailValue - totalCostValue) * 100) / 100
        });
    }

    return {
        tenantShopName: tenant?.shopName,
        currency: tenant?.taxName?.includes('SAR') ? 'SAR' : 'EGP',
        totalUnits: Math.round(grandTotalUnits * 100) / 100,
        totalValuation: Math.round(grandTotalValuation * 100) / 100,
        totalRetailValue: Math.round(grandTotalRetailValue * 100) / 100,
        potentialProfit: Math.round((grandTotalRetailValue - grandTotalValuation) * 100) / 100,
        storesCount: stores.length,
        itemsCount: breakdown.length,
        items: breakdown,
        breakdown
    };
}

module.exports = {
    getStoreInventory,
    getAvailableQuantity,
    getInventoryKPIs,
    getProductStoreMatrix,
    getVariantMovementHistory,
    getMovementsLedger,
    getInventoryValuation
};
