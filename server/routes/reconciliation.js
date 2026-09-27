const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const prisma = require('../prisma');
const { acquireStoreInventoryLock } = require('../services/inventoryLock.service');

// ─────────────────────────────────────────────
// PERMISSION HELPERS
// ─────────────────────────────────────────────

function assertStorePermission(user, storeId) {
    if (user.role === 'admin') return true;
    const allowed = Array.isArray(user.allowedStores) ? user.allowedStores : [];
    if (!allowed.includes(storeId)) {
        const err = new Error('ليس لديك صلاحية لإجراء أو تعديل جرد هذا الفرع.');
        err.statusCode = 403;
        throw err;
    }
    return true;
}

function assertAdminRole(user) {
    if (user.role !== 'admin') {
        const err = new Error('الاعتماد النهائي للجرد مقتصر حصرياً على الإدارة العامة (Admin).');
        err.statusCode = 403;
        throw err;
    }
    return true;
}

// ─────────────────────────────────────────────
// 1. START RECONCILIATION SESSION
// ─────────────────────────────────────────────
router.post('/start', auth, async (req, res) => {
    try {
        const { storeId, notes } = req.body;
        if (!storeId) {
            return res.status(400).json({ msg: 'storeId is required' });
        }

        assertStorePermission(req.user, storeId);

        const result = await prisma.$transaction(async (tx) => {
            // Pessimistic Lock on store row with cross-tenant check
            const stores = await tx.$queryRaw`
                SELECT id, name, "tenantId", "isReconciling", "activeReconciliationId"
                FROM "stores"
                WHERE id = ${storeId}
                FOR UPDATE
            `;
            const store = stores && stores[0];
            if (!store) {
                const notFound = new Error('الفرع المحدد غير موجود.');
                notFound.statusCode = 404;
                throw notFound;
            }
            if (store.tenantId !== req.tenantId) {
                const forbidden = new Error('غير مصرح بالوصول إلى فرع تابع لشركة أو مستأجر آخر.');
                forbidden.statusCode = 403;
                throw forbidden;
            }

            if (store.isReconciling) {
                const conflict = new Error(`الفرع [${store.name}] لديه بالفعل جلسة جرد نشطة (جلسة: ${store.activeReconciliationId}).`);
                conflict.statusCode = 409;
                throw conflict;
            }

            // Create new session
            const session = await tx.openingReconciliationSession.create({
                data: {
                    tenantId: req.tenantId,
                    storeId,
                    status: 'IN_PROGRESS',
                    initiatedById: req.user.id || req.user.username,
                    startedAt: new Date(),
                    notes: notes || null
                }
            });

            // Set store lock indicators
            await tx.store.update({
                where: { id: storeId },
                data: {
                    isReconciling: true,
                    activeReconciliationId: session.id
                }
            });

            // Capture exact snapshot of all products/variants for this store
            const products = await tx.product.findMany({
                where: { tenantId: req.tenantId, active: true },
                orderBy: { name: 'asc' }
            });

            const itemsToCreate = [];

            for (const product of products) {
                const productStores = Array.isArray(product.stores) ? product.stores : [];
                const storeEntry = productStores.find(s => s.storeId === storeId);
                const storeStock = storeEntry ? (Number(storeEntry.stock) || 0) : 0;

                if (product.hasVariants && Array.isArray(product.variants) && product.variants.length > 0) {
                    for (const variant of product.variants) {
                        // Check if VariantStock exists
                        const vStock = await tx.variantStock.findFirst({
                            where: {
                                tenantId: req.tenantId,
                                storeId,
                                productId: product.id,
                                variantId: variant.id
                            }
                        });
                        const legacyQty = vStock ? vStock.quantity : 0;
                        const exceptionFlag = legacyQty < 0 ? 'NEGATIVE_LEGACY_STOCK' : 'NONE';

                        itemsToCreate.push({
                            sessionId: session.id,
                            productId: product.id,
                            variantId: variant.id,
                            legacyQtySnapshot: legacyQty,
                            physicalCount: 0,
                            variance: -legacyQty,
                            costPrice: Number(variant.cost || product.cost) || 0,
                            exceptionFlag,
                            notes: null
                        });
                    }
                } else {
                    // Standard product
                    const legacyQty = storeStock;
                    const exceptionFlag = legacyQty < 0 ? 'NEGATIVE_LEGACY_STOCK' : 'NONE';

                    itemsToCreate.push({
                        sessionId: session.id,
                        productId: product.id,
                        variantId: null,
                        legacyQtySnapshot: legacyQty,
                        physicalCount: 0,
                        variance: -legacyQty,
                        costPrice: Number(product.cost) || 0,
                        exceptionFlag,
                        notes: null
                    });
                }
            }

            if (itemsToCreate.length > 0) {
                await tx.openingReconciliationItem.createMany({
                    data: itemsToCreate
                });
            }

            return { session, itemsCount: itemsToCreate.length };
        });

        res.status(201).json({
            msg: 'تم بدء جلسة الجرد الافتتاحي وتجميد حركات الفرع بنجاح.',
            session: result.session,
            itemsCount: result.itemsCount
        });
    } catch (err) {
        console.error('Error starting reconciliation session:', err.message);
        res.status(err.statusCode || 500).json({ msg: err.message });
    }
});

// ─────────────────────────────────────────────
// 2. LIST RECONCILIATION SESSIONS
// ─────────────────────────────────────────────
router.get('/sessions', auth, async (req, res) => {
    try {
        const { storeId, status } = req.query;
        const where = { tenantId: req.tenantId };

        if (storeId) {
            assertStorePermission(req.user, storeId);
            where.storeId = storeId;
        } else if (req.user.role !== 'admin') {
            const allowed = Array.isArray(req.user.allowedStores) ? req.user.allowedStores : [];
            where.storeId = { in: allowed };
        }

        if (status) {
            where.status = status;
        }

        const sessions = await prisma.openingReconciliationSession.findMany({
            where,
            include: {
                store: { select: { id: true, name: true } },
                _count: { select: { items: true } }
            },
            orderBy: { startedAt: 'desc' }
        });

        res.json(sessions);
    } catch (err) {
        console.error('Error fetching sessions:', err.message);
        res.status(err.statusCode || 500).json({ msg: err.message });
    }
});

// ─────────────────────────────────────────────
// 3. GET SESSION DETAILS & ITEMS
// ─────────────────────────────────────────────
router.get('/sessions/:id', auth, async (req, res) => {
    try {
        const session = await prisma.openingReconciliationSession.findUnique({
            where: { id: req.params.id },
            include: {
                store: { select: { id: true, name: true, location: true, isReconciling: true } },
                items: {
                    include: {
                        product: {
                            select: { id: true, name: true, barcode: true, hasVariants: true, variants: true }
                        }
                    },
                    orderBy: { createdAt: 'asc' }
                }
            }
        });

        if (!session) {
            return res.status(404).json({ msg: 'جلسة الجرد غير موجودة.' });
        }
        if (session.tenantId !== req.tenantId) {
            return res.status(403).json({ msg: 'غير مصرح بالوصول إلى جلسة جرد تابعة لشركة أخرى.' });
        }

        assertStorePermission(req.user, session.storeId);

        // Compute summary metrics
        let totalLegacyQty = 0;
        let totalPhysicalQty = 0;
        let totalVariance = 0;
        let negativeExceptionsCount = 0;

        for (const item of session.items) {
            totalLegacyQty += item.legacyQtySnapshot;
            totalPhysicalQty += item.physicalCount;
            totalVariance += item.variance;
            if (item.exceptionFlag === 'NEGATIVE_LEGACY_STOCK') {
                negativeExceptionsCount++;
            }
        }

        res.json({
            session,
            summary: {
                totalItems: session.items.length,
                totalLegacyQty,
                totalPhysicalQty,
                totalVariance,
                negativeExceptionsCount
            }
        });
    } catch (err) {
        console.error('Error fetching session details:', err.message);
        res.status(err.statusCode || 500).json({ msg: err.message });
    }
});

// ─────────────────────────────────────────────
// 4. BATCH UPDATE PHYSICAL COUNTS (DRAFT)
// ─────────────────────────────────────────────
router.put('/sessions/:id/items', auth, async (req, res) => {
    try {
        const session = await prisma.openingReconciliationSession.findUnique({
            where: { id: req.params.id }
        });

        if (!session) {
            return res.status(404).json({ msg: 'جلسة الجرد غير موجودة.' });
        }
        if (session.tenantId !== req.tenantId) {
            return res.status(403).json({ msg: 'غير مصرح بالوصول إلى جلسة جرد تابعة لشركة أخرى.' });
        }

        if (session.status !== 'IN_PROGRESS') {
            return res.status(400).json({ msg: 'لا يمكن تعديل أسطر الجرد؛ الجلسة ليست قيد الإدخال.' });
        }

        assertStorePermission(req.user, session.storeId);

        const { items } = req.body;
        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ msg: 'قائمة البنود مطلوبة للتحديث.' });
        }

        // Validate all counts before updating
        for (const itm of items) {
            const count = Number(itm.physicalCount);
            if (isNaN(count) || count < 0) {
                return res.status(400).json({
                    msg: `الكمية المدخلة (${itm.physicalCount}) غير صالحة. يجب أن تكون الكمية أكبر من أو تساوي صفراً.`
                });
            }
        }

        await prisma.$transaction(async (tx) => {
            for (const itm of items) {
                const count = Number(itm.physicalCount);
                const currentItem = await tx.openingReconciliationItem.findFirst({
                    where: { id: itm.itemId, sessionId: session.id }
                });

                if (currentItem) {
                    const variance = count - currentItem.legacyQtySnapshot;
                    await tx.openingReconciliationItem.update({
                        where: { id: currentItem.id },
                        data: {
                            physicalCount: count,
                            variance,
                            notes: itm.notes !== undefined ? itm.notes : currentItem.notes
                        }
                    });
                }
            }
        });

        res.json({ msg: 'تم تحديث أرقام الجرد بنجاح.' });
    } catch (err) {
        console.error('Error updating reconciliation items:', err.message);
        res.status(err.statusCode || 500).json({ msg: err.message });
    }
});

// ─────────────────────────────────────────────
// 5. STRICT ALL-OR-NOTHING EXCEL IMPORT
// ─────────────────────────────────────────────
router.post('/sessions/:id/excel-import', auth, async (req, res) => {
    try {
        const session = await prisma.openingReconciliationSession.findUnique({
            where: { id: req.params.id },
            include: {
                items: {
                    include: { product: true }
                }
            }
        });

        if (!session) {
            return res.status(404).json({ msg: 'جلسة الجرد غير موجودة.' });
        }
        if (session.tenantId !== req.tenantId) {
            return res.status(403).json({ msg: 'غير مصرح بالوصول إلى جلسة جرد تابعة لشركة أخرى.' });
        }

        if (session.status !== 'IN_PROGRESS') {
            return res.status(400).json({ msg: 'لا يمكن استيراد ملف الجرد؛ الجلسة ليست في حالة الإدخال.' });
        }

        assertStorePermission(req.user, session.storeId);

        const { rows } = req.body;
        if (!rows || !Array.isArray(rows) || rows.length === 0) {
            return res.status(400).json({ msg: 'الملف فارغ أو لا يحتوي على صفوف صالحة.' });
        }

        // ==========================================
        // PASS 1: Comprehensive Strict Validation
        // ==========================================
        const errors = [];
        const seenCodes = new Set();
        const validItemUpdates = [];

        // Build fast lookup maps for session items
        const itemByBarcode = new Map();
        const itemBySku = new Map();
        const itemByProductIdAndVariant = new Map();

        for (const item of session.items) {
            const prod = item.product;
            if (item.variantId && Array.isArray(prod.variants)) {
                const v = prod.variants.find(varObj => varObj.id === item.variantId);
                if (v) {
                    if (v.barcode) itemByBarcode.set(v.barcode.trim().toLowerCase(), item);
                    if (v.sku) itemBySku.set(v.sku.trim().toLowerCase(), item);
                }
            } else if (!item.variantId) {
                if (prod.barcode) itemByBarcode.set(prod.barcode.trim().toLowerCase(), item);
            }
            const pvKey = `${item.productId}_${item.variantId || 'STANDARD'}`;
            itemByProductIdAndVariant.set(pvKey, item);
        }

        for (let i = 0; i < rows.length; i++) {
            const rowNumber = i + 1;
            const row = rows[i];
            const rawCode = (row.barcode || row.sku || row.code || '').trim().toLowerCase();
            const rawCount = row.physicalCount !== undefined ? row.physicalCount : row.quantity;

            if (!rawCode) {
                errors.push({ row: rowNumber, code: null, reason: 'الباركود أو كود الصنف مفقود.' });
                continue;
            }

            if (seenCodes.has(rawCode)) {
                errors.push({ row: rowNumber, code: rawCode, reason: `تكرار نفس الباركود/الكود في الملف أكثر من مرة: [${rawCode}].` });
                continue;
            }
            seenCodes.add(rawCode);

            const count = Number(rawCount);
            if (isNaN(count)) {
                errors.push({ row: rowNumber, code: rawCode, reason: `الكمية غير صالحة (ليست رقماً): ${rawCount}` });
                continue;
            }

            if (count < 0) {
                errors.push({ row: rowNumber, code: rawCode, reason: `الكمية المدخلة سالبة (${count}). يجب أن تكون الكمية >= 0.` });
                continue;
            }

            // Find matching item in session
            const matchedItem = itemByBarcode.get(rawCode) || itemBySku.get(rawCode);
            if (!matchedItem) {
                errors.push({ row: rowNumber, code: rawCode, reason: `الصنف غير موجود ضمن بنود جرد هذا الفرع.` });
                continue;
            }

            validItemUpdates.push({
                item: matchedItem,
                physicalCount: count,
                notes: row.notes || null
            });
        }

        // If ANY error exists, reject 100% of the rows (Strict All-or-Nothing)
        if (errors.length > 0) {
            return res.status(422).json({
                success: false,
                msg: `تم رفض ملف الاستيراد بالكامل لوجود ${errors.length} خطأ. لم يتم حفظ أي سجل.`,
                errorsCount: errors.length,
                errors
            });
        }

        // ==========================================
        // PASS 2: Atomic Batch Update
        // ==========================================
        await prisma.$transaction(async (tx) => {
            for (const upd of validItemUpdates) {
                const variance = upd.physicalCount - upd.item.legacyQtySnapshot;
                await tx.openingReconciliationItem.update({
                    where: { id: upd.item.id },
                    data: {
                        physicalCount: upd.physicalCount,
                        variance,
                        notes: upd.notes !== null ? upd.notes : upd.item.notes
                    }
                });
            }
        });

        res.json({
            success: true,
            msg: `تم استيراد واعتماد بيانات الجرد لعدد ${validItemUpdates.length} صنف بنجاح وبدقة 100%.`,
            updatedCount: validItemUpdates.length
        });
    } catch (err) {
        console.error('Error importing reconciliation excel:', err.message);
        res.status(err.statusCode || 500).json({ msg: err.message });
    }
});

// ─────────────────────────────────────────────
// 6. SUBMIT RECONCILIATION FOR REVIEW
// ─────────────────────────────────────────────
router.post('/sessions/:id/submit', auth, async (req, res) => {
    try {
        const session = await prisma.openingReconciliationSession.findUnique({
            where: { id: req.params.id }
        });

        if (!session) {
            return res.status(404).json({ msg: 'جلسة الجرد غير موجودة.' });
        }
        if (session.tenantId !== req.tenantId) {
            return res.status(403).json({ msg: 'غير مصرح بالوصول إلى جلسة جرد تابعة لشركة أخرى.' });
        }

        if (session.status !== 'IN_PROGRESS') {
            return res.status(400).json({ msg: 'الجلسة ليست في حالة إدخال ليتم تقديمها للمراجعة.' });
        }

        assertStorePermission(req.user, session.storeId);

        const updated = await prisma.openingReconciliationSession.update({
            where: { id: session.id },
            data: {
                status: 'READY_FOR_REVIEW',
                submittedAt: new Date()
            }
        });

        res.json({
            msg: 'تم تقديم الجرد للمراجعة بنجاح بانتظار اعتماد الإدارة العامة.',
            session: updated
        });
    } catch (err) {
        console.error('Error submitting reconciliation:', err.message);
        res.status(err.statusCode || 500).json({ msg: err.message });
    }
});

// ─────────────────────────────────────────────
// 7. CANCEL RECONCILIATION SESSION
// ─────────────────────────────────────────────
router.post('/sessions/:id/cancel', auth, async (req, res) => {
    try {
        assertAdminRole(req.user);

        await prisma.$transaction(async (tx) => {
            // Lock session row with cross-tenant check
            const sessions = await tx.$queryRaw`
                SELECT * FROM "opening_reconciliation_sessions"
                WHERE id = ${req.params.id}
                FOR UPDATE
            `;
            const session = sessions && sessions[0];
            if (!session) {
                const notFound = new Error('جلسة الجرد غير موجودة.');
                notFound.statusCode = 404;
                throw notFound;
            }
            if (session.tenantId !== req.tenantId) {
                const forbidden = new Error('غير مصرح بالوصول إلى جلسة جرد تابعة لشركة أخرى.');
                forbidden.statusCode = 403;
                throw forbidden;
            }

            if (session.status === 'APPROVED') {
                const err = new Error('لا يمكن إلغاء جلسة تم اعتمادها وترحيلها مسبقاً.');
                err.statusCode = 400;
                throw err;
            }

            // Lock store row
            await tx.$queryRaw`
                SELECT id FROM "stores" WHERE id = ${session.storeId} FOR UPDATE
            `;

            // Mark session cancelled
            await tx.openingReconciliationSession.update({
                where: { id: session.id },
                data: {
                    status: 'CANCELLED',
                    notes: req.body.reason ? `${session.notes || ''} [Cancelled: ${req.body.reason}]` : session.notes
                }
            });

            // Unlock store
            await tx.store.update({
                where: { id: session.storeId },
                data: {
                    isReconciling: false,
                    activeReconciliationId: null
                }
            });

            // Log cancellation
            await tx.auditLog.create({
                data: {
                    tenantId: session.tenantId,
                    user: req.user.username || req.user.id,
                    action: 'OPENING_RECONCILIATION_CANCELLED',
                    details: {
                        sessionId: session.id,
                        storeId: session.storeId,
                        reason: req.body.reason || 'Cancelled by admin'
                    }
                }
            });
        });

        res.json({ msg: 'تم إلغاء جلسة الجرد وتحرير الفرع بنجاح دون أي تعديل في المخزون.' });
    } catch (err) {
        console.error('Error cancelling reconciliation:', err.message);
        res.status(err.statusCode || 500).json({ msg: err.message });
    }
});

// ─────────────────────────────────────────────
// 8. APPROVE RECONCILIATION SESSION (ATOMIC COMMIT)
// ─────────────────────────────────────────────
router.post('/sessions/:id/approve', auth, async (req, res) => {
    try {
        assertAdminRole(req.user);

        const result = await prisma.$transaction(async (tx) => {
            // 1. Pessimistic Row Lock on Session with cross-tenant check
            const sessions = await tx.$queryRaw`
                SELECT * FROM "opening_reconciliation_sessions"
                WHERE id = ${req.params.id}
                FOR UPDATE
            `;
            const session = sessions && sessions[0];
            if (!session) {
                const notFound = new Error('جلسة الجرد غير موجودة.');
                notFound.statusCode = 404;
                throw notFound;
            }
            if (session.tenantId !== req.tenantId) {
                const forbidden = new Error('غير مصرح بالوصول إلى جلسة جرد تابعة لشركة أخرى.');
                forbidden.statusCode = 403;
                throw forbidden;
            }

            if (session.status !== 'READY_FOR_REVIEW') {
                const conflict = new Error(`لا يمكن اعتماد الجلسة في حالتها الحالية (${session.status}). يجب أن تكون في حالة جاهزة للمراجعة (READY_FOR_REVIEW).`);
                conflict.statusCode = 409;
                throw conflict;
            }

            const batchId = `OPENING_${session.id}`;

            // 2. Atomic state claim to APPROVING
            await tx.openingReconciliationSession.update({
                where: { id: session.id },
                data: {
                    status: 'APPROVING',
                    batchId,
                    approvingStartedAt: new Date()
                }
            });

            // 3. Lock store row
            await tx.$queryRaw`
                SELECT id FROM "stores" WHERE id = ${session.storeId} FOR UPDATE
            `;

            // 4. Load all items with products
            const items = await tx.openingReconciliationItem.findMany({
                where: { sessionId: session.id },
                include: { product: true }
            });

            let positiveMovementCount = 0;
            let zeroStockCount = 0;

            for (const item of items) {
                const physicalCount = Number(item.physicalCount) || 0;

                // A. Establish VariantStock as the single source of truth
                const existingVStock = await tx.variantStock.findFirst({
                    where: {
                        tenantId: session.tenantId,
                        storeId: session.storeId,
                        productId: item.productId,
                        variantId: item.variantId || null
                    }
                });

                if (existingVStock) {
                    await tx.variantStock.update({
                        where: { id: existingVStock.id },
                        data: { quantity: physicalCount }
                    });
                } else {
                    await tx.variantStock.create({
                        data: {
                            tenantId: session.tenantId,
                            storeId: session.storeId,
                            productId: item.productId,
                            variantId: item.variantId || null,
                            quantity: physicalCount
                        }
                    });
                }

                // B. Ledger Movement Semantics:
                // physicalCount > 0 => INSERT OPENING_STOCK movement
                // physicalCount === 0 => DO NOT create zero-delta movement (Zero Stock Rule)
                if (physicalCount > 0) {
                    await tx.inventoryMovement.create({
                        data: {
                            tenantId: session.tenantId,
                            storeId: session.storeId,
                            productId: item.productId,
                            variantId: item.variantId || null,
                            type: 'OPENING_STOCK',
                            quantityBefore: 0,
                            quantityDelta: physicalCount,
                            quantityAfter: physicalCount,
                            referenceType: 'RECONCILIATION_SESSION',
                            referenceId: session.id,
                            batchId,
                            notes: `Opening Reconciliation - Legacy: ${item.legacyQtySnapshot}, Physical: ${physicalCount}, Variance: ${item.variance}`
                        }
                    });
                    positiveMovementCount++;
                } else {
                    zeroStockCount++;
                }

                // C. Synchronize Legacy Projection Cache
                const prod = item.product;
                const stores = Array.isArray(prod.stores) ? [...prod.stores] : [];
                const sIdx = stores.findIndex(s => s.storeId === session.storeId);
                if (sIdx >= 0) {
                    stores[sIdx].stock = physicalCount;
                } else {
                    stores.push({ storeId: session.storeId, stock: physicalCount });
                }

                const totalProductStock = stores.reduce((sum, s) => sum + (Number(s.stock) || 0), 0);

                let variants = Array.isArray(prod.variants) ? [...prod.variants] : [];
                if (item.variantId && variants.length > 0) {
                    const vIdx = variants.findIndex(v => v.id === item.variantId);
                    if (vIdx >= 0) {
                        variants[vIdx].stock = physicalCount;
                    }
                }

                await tx.product.update({
                    where: { id: prod.id },
                    data: {
                        stores,
                        stock: totalProductStock,
                        variants
                    }
                });
            }

            // 5. Unlock the store
            await tx.store.update({
                where: { id: session.storeId },
                data: {
                    isReconciling: false,
                    activeReconciliationId: null
                }
            });

            // 6. Transition session to APPROVED
            const approvedSession = await tx.openingReconciliationSession.update({
                where: { id: session.id },
                data: {
                    status: 'APPROVED',
                    approvedAt: new Date(),
                    approvedById: req.user.id || req.user.username
                }
            });

            // 7. General AuditLog
            await tx.auditLog.create({
                data: {
                    tenantId: session.tenantId,
                    user: req.user.username || req.user.id,
                    action: 'OPENING_RECONCILIATION_APPROVED',
                    details: {
                        sessionId: session.id,
                        storeId: session.storeId,
                        batchId,
                        totalItems: items.length,
                        positiveMovementsCreated: positiveMovementCount,
                        zeroStockCount,
                        approvedAt: new Date()
                    }
                }
            });

            return {
                approvedSession,
                batchId,
                totalItems: items.length,
                positiveMovementCount,
                zeroStockCount
            };
        });

        res.json({
            msg: 'تم اعتماد الجرد الافتتاحي وتأسيس أرصدة المخزون بنجاح.',
            session: result.approvedSession,
            batchId: result.batchId,
            stats: {
                totalItems: result.totalItems,
                movementsCreated: result.positiveMovementCount,
                zeroStockItems: result.zeroStockCount
            }
        });
    } catch (err) {
        console.error('Error approving reconciliation:', err.message);
        res.status(err.statusCode || 500).json({ msg: err.message });
    }
});

module.exports = router;
