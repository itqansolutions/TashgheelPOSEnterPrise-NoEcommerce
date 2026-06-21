const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const prisma = require('../prisma');

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

        const transferItems = [];

        for (const item of items) {
            const product = await prisma.product.findFirst({
                where: { id: item.productId, tenantId: req.tenantId }
            });
            if (!product) {
                return res.status(404).json({ msg: `Product not found: ${item.productId}` });
            }

            const qty = parseInt(item.qty) || 0;
            if (qty <= 0) {
                return res.status(400).json({ msg: `Invalid quantity for product ${product.name}` });
            }

            const stores = Array.isArray(product.stores) ? [...product.stores] : [];
            let variants = Array.isArray(product.variants) ? [...product.variants] : [];

            // Handle variant stock if variantId is provided
            if (item.variantId) {
                const vIdx = variants.findIndex(v => v.id === item.variantId || v.sku === item.variantId);
                if (vIdx >= 0) {
                    variants[vIdx].stock = (variants[vIdx].stock || 0) - qty;
                }
            }

            // Deduct from source store
            const fromIdx = stores.findIndex(s => s.storeId === fromStoreId);
            if (fromIdx >= 0) {
                stores[fromIdx].stock = (stores[fromIdx].stock || 0) - qty;
            } else {
                stores.push({ storeId: fromStoreId, stock: -qty });
            }

            // Add to destination store
            const toIdx = stores.findIndex(s => s.storeId === toStoreId);
            if (toIdx >= 0) {
                stores[toIdx].stock = (stores[toIdx].stock || 0) + qty;
            } else {
                stores.push({ storeId: toStoreId, stock: qty });
            }

            // Recalculate global stock as sum of all store stocks
            const globalStock = stores.reduce((sum, s) => sum + (s.stock || 0), 0);

            await prisma.product.update({
                where: { id: product.id },
                data: { stores, stock: globalStock, variants }
            });

            transferItems.push({
                productId: product.id,
                productName: product.name,
                variantId: item.variantId || null,
                qty
            });
        }

        const transferCount = await prisma.stockTransfer.count({ where: { tenantId: req.tenantId } });
        const transferRef = 'TRF-' + (transferCount + 1);

        const transfer = await prisma.stockTransfer.create({
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

        res.json(transfer);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
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
