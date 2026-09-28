const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const prisma = require('../prisma');
const { acquireMultiStoreInventoryLocks } = require('../services/inventoryLock.service');
const inventoryMutationService = require('../services/inventoryMutation.service');

// ================= STOCK TRANSFERS =================

// @route   POST /api/stock-transfers
// @desc    Create a stock transfer between two stores
router.post('/', auth, async (req, res) => {
    try {
        const { fromStoreId, toStoreId, items, notes } = req.body;

        if (!fromStoreId || !toStoreId) {
            return res.status(400).json({ msg: 'fromStoreId and toStoreId are required' });
        }
        if (fromStoreId === toStoreId) {
            return res.status(400).json({ msg: 'Source and destination stores must be different' });
        }

        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ msg: 'At least one item is required' });
        }

        // Validate both stores belong to this tenant
        const fromStore = await prisma.store.findFirst({
            where: { id: fromStoreId, tenantId: req.tenantId }
        });
        if (!fromStore) return res.status(404).json({ msg: 'Source store not found' });

        const toStore = await prisma.store.findFirst({
            where: { id: toStoreId, tenantId: req.tenantId }
        });
        if (!toStore) return res.status(404).json({ msg: 'Destination store not found' });

        let createdTransfer = null;

        await prisma.$transaction(async (tx) => {
            const transferCount = await tx.stockTransfer.count({ where: { tenantId: req.tenantId } });
            // Authoritative Backend Stock Availability Validation under Store Lock
            for (const item of items) {
                const requestedQty = Math.abs(Number(item.qty || 0));
                if (requestedQty <= 0) {
                    const zeroErr = new Error('Transfer quantity must be greater than zero');
                    zeroErr.statusCode = 400;
                    throw zeroErr;
                }

                const product = await tx.product.findFirst({
                    where: { id: item.productId, tenantId: req.tenantId }
                });

                if (product && product.trackStock !== false) {
                    const sourceStock = await tx.variantStock.findFirst({
                        where: {
                            tenantId: req.tenantId,
                            storeId: fromStoreId,
                            productId: item.productId,
                            variantId: item.variantId ? String(item.variantId) : null
                        }
                    });

                    const availableQty = sourceStock ? Number(sourceStock.quantity) : 0;
                    if (requestedQty > availableQty) {
                        const insuffErr = new Error(
                            `الكمية المطلوبة للتحويل (${requestedQty}) تتجاوز الرصيد المتاح (${availableQty}) في مخزن المصدر للمنتج [${product.name}]`
                        );
                        insuffErr.statusCode = 400;
                        throw insuffErr;
                    }
                }
            }

            // Authoritative Atomic Stock Transfer via Centralized Service
            await inventoryMutationService.recordTransfer(tx, {
                tenantId: req.tenantId,
                fromStoreId,
                toStoreId,
                transferRef,
                items,
                performedBy: req.user.username,
                notes: notes || null
            });

            const transferItems = [];
            for (const item of items) {
                const product = await tx.product.findFirst({
                    where: { id: item.productId, tenantId: req.tenantId }
                });
                transferItems.push({
                    productId: item.productId,
                    productName: product ? product.name : 'Unknown Product',
                    variantId: item.variantId || null,
                    qty: parseInt(item.qty) || 0
                });
            }

            createdTransfer = await tx.stockTransfer.create({
                data: {
                    tenantId: req.tenantId,
                    fromStoreId,
                    toStoreId,
                    transferRef,
                    items: transferItems,
                    notes: notes || null,
                    transferredBy: req.user.username,
                    date: new Date()
                }
            });
        });

        res.json(createdTransfer);
    } catch (err) {
        if (err.statusCode === 423 || err.code === 'STORE_LOCKED_FOR_RECONCILIATION') {
            return res.status(423).json({ msg: err.message, code: err.code });
        }
        console.error(err.message);
        res.status(err.statusCode || 500).json({ msg: err.message || 'Server Error' });
    }
});

// @route   GET /api/stock-transfers
// @desc    List all stock transfers for tenant, ordered by date desc
router.get('/', auth, async (req, res) => {
    try {
        const transfers = await prisma.stockTransfer.findMany({
            where: { tenantId: req.tenantId },
            orderBy: { date: 'desc' }
        });
        res.json(transfers);
    } catch (err) {
        if (err.statusCode === 423 || err.code === 'STORE_LOCKED_FOR_RECONCILIATION') {
            return res.status(423).json({ msg: err.message, code: err.code });
        }
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/stock-transfers/:id
// @desc    Get one stock transfer
router.get('/:id', auth, async (req, res) => {
    try {
        const transfer = await prisma.stockTransfer.findFirst({
            where: { id: req.params.id, tenantId: req.tenantId }
        });
        if (!transfer) return res.status(404).json({ msg: 'Stock transfer not found' });

        res.json(transfer);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;
