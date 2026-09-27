/**
 * server/services/inventoryLock.service.js
 *
 * Mandatory Inventory Mutation Protocol (v2.5)
 * Guarantees zero race conditions against ongoing reconciliation sessions
 * and prevents multi-store deadlocks using deterministic ordering.
 */

class StoreLockedForReconciliationError extends Error {
    constructor(store) {
        const message = `الفرع [${store.name || store.id}] مغلق حالياً لإجراء الجرد الافتتاحي (جلسة: ${store.activeReconciliationId || 'نشطة'}). لا يمكن تسجيل أي مبيعات أو حركات مخزنية حتى اكتمال الاعتماد.`;
        super(message);
        this.name = 'StoreLockedForReconciliationError';
        this.statusCode = 423; // HTTP 423 Locked
        this.code = 'STORE_LOCKED_FOR_RECONCILIATION';
        this.storeId = store.id;
        this.sessionId = store.activeReconciliationId;
    }
}

/**
 * Acquire pessimistic row-level lock (FOR UPDATE) on a single store
 * and verify that the store is not undergoing opening reconciliation.
 *
 * @param {object} tx - Prisma transaction or client
 * @param {string} storeId - Store ID to lock and inspect
 * @returns {Promise<object>} The locked store record
 */
async function acquireStoreInventoryLock(tx, storeId) {
    if (!storeId) {
        throw new Error('Store ID is required to acquire inventory lock');
    }

    const stores = await tx.$queryRaw`
        SELECT id, name, "isReconciling", "activeReconciliationId"
        FROM "stores"
        WHERE id = ${storeId}
        FOR UPDATE
    `;

    const store = stores && stores[0];
    if (!store) {
        const notFoundErr = new Error(`الفرع المطلوب [${storeId}] غير موجود.`);
        notFoundErr.statusCode = 404;
        throw notFoundErr;
    }

    if (store.isReconciling) {
        throw new StoreLockedForReconciliationError(store);
    }

    return store;
}

/**
 * Acquire pessimistic row-level locks (FOR UPDATE) on multiple stores
 * in deterministic lexicographical order to completely eliminate deadlocks.
 *
 * @param {object} tx - Prisma transaction or client
 * @param {string[]} storeIds - Array of Store IDs involved in multi-store mutation
 * @returns {Promise<Map<string, object>>} Map of storeId -> store record
 */
async function acquireMultiStoreInventoryLocks(tx, storeIds) {
    const validIds = (storeIds || []).filter(id => typeof id === 'string' && id.trim().length > 0);
    const uniqueSortedIds = Array.from(new Set(validIds)).sort();

    if (uniqueSortedIds.length === 0) {
        return new Map();
    }

    const stores = await tx.$queryRaw`
        SELECT id, name, "isReconciling", "activeReconciliationId"
        FROM "stores"
        WHERE id = ANY(${uniqueSortedIds}::text[])
        ORDER BY id ASC
        FOR UPDATE
    `;

    const storeMap = new Map();
    for (const store of stores) {
        if (store.isReconciling) {
            throw new StoreLockedForReconciliationError(store);
        }
        storeMap.set(store.id, store);
    }

    // Verify all requested stores exist
    for (const id of uniqueSortedIds) {
        if (!storeMap.has(id)) {
            const notFoundErr = new Error(`الفرع المطلوب [${id}] غير موجود.`);
            notFoundErr.statusCode = 404;
            throw notFoundErr;
        }
    }

    return storeMap;
}

module.exports = {
    StoreLockedForReconciliationError,
    acquireStoreInventoryLock,
    acquireMultiStoreInventoryLocks,
};
