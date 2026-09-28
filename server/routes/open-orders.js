const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const bcrypt = require('bcryptjs');
const prisma = require('../prisma');
const { acquireStoreInventoryLock } = require('../services/inventoryLock.service');
const inventoryMutationService = require('../services/inventoryMutation.service');

// ================= OPEN ORDERS =================

// Helper: verify manager password against tenant record
async function verifyManagerPassword(tenantId, password) {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant || !tenant.managerPassword) return false;
    return bcrypt.compare(password, tenant.managerPassword);
}

// @route   POST /api/open-orders
// @desc    Create a new open order
router.post('/', auth, async (req, res) => {
    try {
        const { storeId, customerId, items, notes } = req.body;

        if (!storeId || !items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ msg: 'storeId and items are required' });
        }

        let order = null;

        await prisma.$transaction(async (tx) => {
            await acquireStoreInventoryLock(tx, storeId);

            // Calculate total
            const totalAmount = items.reduce((sum, item) => sum + (parseFloat(item.price) * parseInt(item.qty || 1)), 0);

            // Generate receiptId
            const count = await tx.openOrder.count({ where: { tenantId: req.tenantId } });
            const receiptId = 'OO-' + (count + 1);

            // Create open order
            order = await tx.openOrder.create({
                data: {
                    tenantId: req.tenantId,
                    storeId,
                    customerId: customerId || null,
                    receiptId,
                    items,
                    totalAmount,
                    paidAmount: 0,
                    payments: [],
                    status: 'open',
                    notes: notes || null,
                    cashier: req.user.username,
                    createdAt: new Date()
                }
            });

            // Authoritative inventory deduction
            await inventoryMutationService.recordSale(tx, {
                tenantId: req.tenantId,
                storeId,
                saleId: order.id,
                items,
                performedBy: req.user.username,
                notes: `Open Order - ${receiptId}`
            });

            // Customer ledger & balance
            if (customerId) {
                const customer = await tx.customer.findFirst({
                    where: { id: customerId, tenantId: req.tenantId }
                });
                if (customer) {
                    await tx.customer.update({
                        where: { id: customer.id },
                        data: { balance: customer.balance + totalAmount }
                    });
                    await tx.ledgerTransaction.create({
                        data: {
                            tenantId: req.tenantId,
                            entityType: 'customer',
                            entityId: customer.id,
                            type: 'open_order',
                            amount: totalAmount,
                            referenceId: order.id,
                            date: new Date(),
                            cashier: req.user.username,
                            notes: 'Open Order - ' + receiptId
                        }
                    });
                }
            }
        });

        res.json(order);
    } catch (err) {
        if (err.statusCode === 423 || err.code === 'STORE_LOCKED_FOR_RECONCILIATION') {
            return res.status(423).json({ msg: err.message, code: err.code });
        }
        console.error(err.message);
        res.status(err.statusCode || 500).json({ msg: err.message || 'Server Error' });
    }
});

// @route   GET /api/open-orders
// @desc    List open orders for tenant. Optional ?status=open|settled|cancelled
router.get('/', auth, async (req, res) => {
    try {
        const { status } = req.query;

        const where = {
            tenantId: req.tenantId,
            ...(status && { status })
        };

        const orders = await prisma.openOrder.findMany({
            where,
            orderBy: { createdAt: 'desc' }
        });

        // Attach customer name via separate lookup
        const result = await Promise.all(orders.map(async (order) => {
            let customerName = null;
            if (order.customerId) {
                const customer = await prisma.customer.findFirst({
                    where: { id: order.customerId, tenantId: req.tenantId },
                    select: { id: true, name: true, phone: true }
                });
                customerName = customer ? customer.name : null;
            }
            return { ...order, customerName };
        }));

        res.json(result);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/open-orders/:id
// @desc    Get one open order
router.get('/:id', auth, async (req, res) => {
    try {
        const order = await prisma.openOrder.findFirst({
            where: { id: req.params.id, tenantId: req.tenantId }
        });
        if (!order) return res.status(404).json({ msg: 'Open order not found' });

        res.json(order);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/open-orders/:id/pay
// @desc    Record a partial or full payment on an open order
router.post('/:id/pay', auth, async (req, res) => {
    try {
        const { amount, method, notes } = req.body;

        const order = await prisma.openOrder.findFirst({
            where: { id: req.params.id, tenantId: req.tenantId }
        });
        if (!order) return res.status(404).json({ msg: 'Open order not found' });

        if (order.status !== 'open') {
            return res.status(400).json({ msg: 'Order is not open' });
        }

        const payAmount = parseFloat(amount);
        if (!payAmount || payAmount <= 0) {
            return res.status(400).json({ msg: 'Amount must be greater than 0' });
        }

        const remaining = order.totalAmount - order.paidAmount;
        if (payAmount > remaining) {
            return res.status(400).json({ msg: `Amount exceeds remaining balance of ${remaining}` });
        }

        const newPaidAmount = order.paidAmount + payAmount;
        const isFullyPaid = newPaidAmount >= order.totalAmount;

        const payments = Array.isArray(order.payments) ? [...order.payments] : [];
        payments.push({
            amount: payAmount,
            method: method || 'cash',
            notes: notes || null,
            date: new Date().toISOString(),
            cashier: req.user.username
        });

        let updatedOrder = await prisma.openOrder.update({
            where: { id: order.id },
            data: {
                paidAmount: newPaidAmount,
                payments,
                status: isFullyPaid ? 'settled' : 'open'
            }
        });

        // Customer ledger: record payment (negative = reducing debt)
        if (order.customerId) {
            const customer = await prisma.customer.findFirst({
                where: { id: order.customerId, tenantId: req.tenantId }
            });
            if (customer) {
                await prisma.customer.update({
                    where: { id: customer.id },
                    data: { balance: customer.balance - payAmount }
                });
                await prisma.ledgerTransaction.create({
                    data: {
                        tenantId: req.tenantId,
                        entityType: 'customer',
                        entityId: customer.id,
                        type: 'open_order_payment',
                        amount: -payAmount,
                        referenceId: order.id,
                        date: new Date(),
                        cashier: req.user.username,
                        notes: notes || ('Open Order Payment - ' + order.receiptId)
                    }
                });
            }
        }

        // If fully settled, create a proper Sale record
        if (isFullyPaid) {
            const shift = await prisma.shift.findFirst({
                where: {
                    tenantId: req.tenantId,
                    cashier: req.user.username,
                    status: 'open'
                }
            });

            let shiftId = shift ? shift.id : null;
            let saleReceiptId = order.receiptId + '-S';

            if (shiftId) {
                const shiftCount = await prisma.sale.count({ where: { shiftId } });
                saleReceiptId = String(shiftCount + 1);
            }

            await prisma.sale.create({
                data: {
                    tenantId: req.tenantId,
                    storeId: order.storeId,
                    receiptId: saleReceiptId,
                    shiftId,
                    date: new Date(),
                    method: method || 'cash',
                    orderType: 'instore',
                    cashier: req.user.username,
                    customerId: order.customerId || null,
                    total: order.totalAmount,
                    taxAmount: 0,
                    items: Array.isArray(order.items) ? order.items : [],
                    splitPayments: []
                }
            });
        }

        res.json(updatedOrder);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/open-orders/:id/add-items
// @desc    Add items to an open order (requires manager password)
router.post('/:id/add-items', auth, async (req, res) => {
    try {
        const { items, managerPassword } = req.body;

        if (!managerPassword) {
            return res.status(400).json({ msg: 'Manager password is required' });
        }

        const isValid = await verifyManagerPassword(req.tenantId, managerPassword);
        if (!isValid) {
            return res.status(401).json({ msg: 'Incorrect manager password', code: 'WRONG_PASSWORD' });
        }

        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ msg: 'Items array is required' });
        }

        const order = await prisma.openOrder.findFirst({
            where: { id: req.params.id, tenantId: req.tenantId }
        });
        if (!order) return res.status(404).json({ msg: 'Open order not found' });

        if (order.status !== 'open') {
            return res.status(400).json({ msg: 'Cannot modify a non-open order' });
        }

        const addedAmount = items.reduce((sum, item) => sum + (parseFloat(item.price) * parseInt(item.qty || 1)), 0);
        const currentItems = Array.isArray(order.items) ? [...order.items] : [];
        const newItems = [...currentItems, ...items];

        const newTotal = order.totalAmount + addedAmount;
        let updatedOrder = null;

        await prisma.$transaction(async (tx) => {
            await acquireStoreInventoryLock(tx, order.storeId);

            // Deduct stock for new items via centralized service
            await inventoryMutationService.recordSale(tx, {
                tenantId: req.tenantId,
                storeId: order.storeId,
                saleId: `${order.id}-ADD-${Date.now()}`,
                items,
                performedBy: req.user.username,
                notes: `Items added to Open Order - ${order.receiptId}`
            });

            updatedOrder = await tx.openOrder.update({
                where: { id: order.id },
                data: {
                    items: newItems,
                    totalAmount: newTotal
                }
            });

            // Update customer balance if applicable
            if (order.customerId) {
                const customer = await tx.customer.findFirst({
                    where: { id: order.customerId, tenantId: req.tenantId }
                });
                if (customer) {
                    await tx.customer.update({
                        where: { id: customer.id },
                        data: { balance: customer.balance + addedAmount }
                    });
                    await tx.ledgerTransaction.create({
                        data: {
                            tenantId: req.tenantId,
                            entityType: 'customer',
                            entityId: customer.id,
                            type: 'open_order',
                            amount: addedAmount,
                            referenceId: order.id,
                            date: new Date(),
                            cashier: req.user.username,
                            notes: 'Items added to Open Order - ' + order.receiptId
                        }
                    });
                }
            }
        });

        res.json(updatedOrder);
    } catch (err) {
        if (err.statusCode === 423 || err.code === 'STORE_LOCKED_FOR_RECONCILIATION') {
            return res.status(423).json({ msg: err.message, code: err.code });
        }
        console.error(err.message);
        res.status(err.statusCode || 500).json({ msg: err.message || 'Server Error' });
    }
});

// @route   DELETE /api/open-orders/:id/items/:productCode
// @desc    Remove an item from an open order (requires manager password)
router.delete('/:id/items/:productCode', auth, async (req, res) => {
    try {
        const { managerPassword } = req.body;

        if (!managerPassword) {
            return res.status(400).json({ msg: 'Manager password is required' });
        }

        const isValid = await verifyManagerPassword(req.tenantId, managerPassword);
        if (!isValid) {
            return res.status(401).json({ msg: 'Incorrect manager password', code: 'WRONG_PASSWORD' });
        }

        const order = await prisma.openOrder.findFirst({
            where: { id: req.params.id, tenantId: req.tenantId }
        });
        if (!order) return res.status(404).json({ msg: 'Open order not found' });

        if (order.status !== 'open') {
            return res.status(400).json({ msg: 'Cannot remove items from a non-open order' });
        }

        const currentItems = Array.isArray(order.items) ? [...order.items] : [];
        const itemIdx = currentItems.findIndex(i => i.code === req.params.productCode);

        if (itemIdx === -1) {
            return res.status(404).json({ msg: 'Item not found in this order' });
        }

        const removedItem = currentItems[itemIdx];
        const removedAmount = parseFloat(removedItem.price) * parseInt(removedItem.qty || 1);
        const newItems = currentItems.filter((_, idx) => idx !== itemIdx);
        const newTotal = order.totalAmount - removedAmount;
        let updatedOrder = null;

        await prisma.$transaction(async (tx) => {
            await acquireStoreInventoryLock(tx, order.storeId);

            // Restore stock via centralized service
            await inventoryMutationService.recordReturn(tx, {
                tenantId: req.tenantId,
                storeId: order.storeId,
                returnId: `${order.id}-REM-${Date.now()}`,
                saleId: order.id,
                items: [{
                    productId: removedItem.productId || null,
                    barcode: removedItem.barcode || removedItem.code || null,
                    code: removedItem.code || null,
                    qty: parseInt(removedItem.qty || 1),
                    variantId: removedItem.variantId || null
                }],
                performedBy: req.user.username,
                notes: `Item removed from Open Order - ${order.receiptId}`
            });

            updatedOrder = await tx.openOrder.update({
                where: { id: order.id },
                data: {
                    items: newItems,
                    totalAmount: newTotal
                }
            });

            // Reverse customer balance if applicable
            if (order.customerId) {
                const customer = await tx.customer.findFirst({
                    where: { id: order.customerId, tenantId: req.tenantId }
                });
                if (customer) {
                    await tx.customer.update({
                        where: { id: customer.id },
                        data: { balance: customer.balance - removedAmount }
                    });
                    await tx.ledgerTransaction.create({
                        data: {
                            tenantId: req.tenantId,
                            entityType: 'customer',
                            entityId: customer.id,
                            type: 'open_order_adjustment',
                            amount: -removedAmount,
                            referenceId: order.id,
                            date: new Date(),
                            cashier: req.user.username,
                            notes: 'Item removed from Open Order - ' + order.receiptId
                        }
                    });
                }
            }
        });

        res.json(updatedOrder);
    } catch (err) {
        if (err.statusCode === 423 || err.code === 'STORE_LOCKED_FOR_RECONCILIATION') {
            return res.status(423).json({ msg: err.message, code: err.code });
        }
        console.error(err.message);
        res.status(err.statusCode || 500).json({ msg: err.message || 'Server Error' });
    }
});

// @route   POST /api/open-orders/:id/cancel
// @desc    Cancel an open order, restore all stock, reverse customer balance
router.post('/:id/cancel', auth, async (req, res) => {
    try {
        const order = await prisma.openOrder.findFirst({
            where: { id: req.params.id, tenantId: req.tenantId }
        });
        if (!order) return res.status(404).json({ msg: 'Open order not found' });

        if (order.status !== 'open') {
            return res.status(400).json({ msg: `Order is already ${order.status}` });
        }

        const orderItems = Array.isArray(order.items) ? order.items : [];

        await prisma.$transaction(async (tx) => {
            await acquireStoreInventoryLock(tx, order.storeId);

            // Restore stock for all items via centralized service
            if (orderItems.length > 0) {
                await inventoryMutationService.recordCancelSale(tx, {
                    tenantId: req.tenantId,
                    storeId: order.storeId,
                    cancelId: `CANCEL_${order.id}`,
                    saleId: order.id,
                    items: orderItems,
                    performedBy: req.user.username,
                    notes: `Open Order Cancelled - ${order.receiptId}`
                });
            }

            await tx.openOrder.update({
                where: { id: order.id },
                data: { status: 'cancelled' }
            });

            // Reverse customer balance
            if (order.customerId) {
                const unpaidAmount = order.totalAmount - order.paidAmount;
                if (unpaidAmount > 0) {
                    const customer = await tx.customer.findFirst({
                        where: { id: order.customerId, tenantId: req.tenantId }
                    });
                    if (customer) {
                        await tx.customer.update({
                            where: { id: customer.id },
                            data: { balance: customer.balance - unpaidAmount }
                        });
                        await tx.ledgerTransaction.create({
                            data: {
                                tenantId: req.tenantId,
                                entityType: 'customer',
                                entityId: customer.id,
                                type: 'open_order_cancel',
                                amount: -unpaidAmount,
                                referenceId: order.id,
                                date: new Date(),
                                cashier: req.user.username,
                                notes: 'Open Order Cancelled - ' + order.receiptId
                            }
                        });
                    }
                }
            }
        });

        res.json({ msg: 'Open order cancelled and stock restored' });
    } catch (err) {
        if (err.statusCode === 423 || err.code === 'STORE_LOCKED_FOR_RECONCILIATION') {
            return res.status(423).json({ msg: err.message, code: err.code });
        }
        console.error(err.message);
        res.status(err.statusCode || 500).json({ msg: err.message || 'Server Error' });
    }
});

module.exports = router;
