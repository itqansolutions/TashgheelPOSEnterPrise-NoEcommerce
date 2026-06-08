const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const bcrypt = require('bcryptjs');
const prisma = require('../prisma');

// ================= STORES (WAREHOUSES) =================

// @route   GET /api/stores
router.get('/stores', auth, async (req, res) => {
    try {
        const stores = await prisma.store.findMany({
            where: { tenantId: req.tenantId },
            orderBy: { createdAt: 'desc' }
        });
        res.json(stores);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/stores
router.post('/stores', auth, async (req, res) => {
    try {
        const store = await prisma.store.create({
            data: { tenantId: req.tenantId, ...req.body }
        });
        res.json(store);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   PUT /api/stores/:id
router.put('/stores/:id', auth, async (req, res) => {
    try {
        const store = await prisma.store.findFirst({
            where: { id: req.params.id, tenantId: req.tenantId }
        });
        if (!store) return res.status(404).json({ msg: 'Store not found' });

        const { name, location } = req.body;
        const updated = await prisma.store.update({
            where: { id: req.params.id },
            data: {
                ...(name !== undefined && { name }),
                ...(location !== undefined && { location })
            }
        });
        res.json(updated);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   DELETE /api/stores/:id
router.delete('/stores/:id', auth, async (req, res) => {
    try {
        const store = await prisma.store.findFirst({
            where: { id: req.params.id, tenantId: req.tenantId }
        });
        if (!store) return res.status(404).json({ msg: 'Store not found' });

        await prisma.store.delete({ where: { id: req.params.id } });
        res.json({ msg: 'Store removed' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// ================= CUSTOMERS =================

// @route   GET /api/customers
router.get('/customers', auth, async (req, res) => {
    try {
        const customers = await prisma.customer.findMany({
            where: { tenantId: req.tenantId }
        });
        res.json(customers);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/customers
router.post('/customers', auth, async (req, res) => {
    try {
        const customer = await prisma.customer.create({
            data: { tenantId: req.tenantId, ...req.body }
        });
        res.json(customer);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   PUT /api/customers/:id
router.put('/customers/:id', auth, async (req, res) => {
    try {
        const customer = await prisma.customer.findFirst({
            where: { id: req.params.id, tenantId: req.tenantId }
        });
        if (!customer) return res.status(404).json({ msg: 'Customer not found' });

        const { name, phone, email, address, loyaltyPoints, balance } = req.body;
        const updated = await prisma.customer.update({
            where: { id: req.params.id },
            data: {
                ...(name !== undefined && { name }),
                ...(phone !== undefined && { phone }),
                ...(email !== undefined && { email }),
                ...(address !== undefined && { address }),
                ...(loyaltyPoints !== undefined && { loyaltyPoints }),
                ...(balance !== undefined && { balance })
            }
        });
        res.json(updated);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   DELETE /api/customers/:id
router.delete('/customers/:id', auth, async (req, res) => {
    try {
        const customer = await prisma.customer.findFirst({
            where: { id: req.params.id, tenantId: req.tenantId }
        });
        if (!customer) return res.status(404).json({ msg: 'Customer not found' });

        await prisma.customer.delete({ where: { id: req.params.id } });
        res.json({ msg: 'Customer removed' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/customers/:id/statement
router.get('/customers/:id/statement', auth, async (req, res) => {
    try {
        const transactions = await prisma.ledgerTransaction.findMany({
            where: {
                tenantId: req.tenantId,
                entityType: 'customer',
                entityId: req.params.id
            },
            orderBy: { date: 'desc' }
        });
        res.json(transactions);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/customers/:id/pay
router.post('/customers/:id/pay', auth, async (req, res) => {
    try {
        const { amount, notes } = req.body;
        if (!amount || amount <= 0) return res.status(400).json({ msg: 'Valid amount missing' });

        const customer = await prisma.customer.findFirst({
            where: { id: req.params.id, tenantId: req.tenantId }
        });
        if (!customer) return res.status(404).json({ msg: 'Customer not found' });

        const updatedCustomer = await prisma.customer.update({
            where: { id: customer.id },
            data: { balance: customer.balance - amount }
        });

        const ledgerTx = await prisma.ledgerTransaction.create({
            data: {
                tenantId: req.tenantId,
                entityType: 'customer',
                entityId: customer.id,
                type: 'payment',
                amount: -amount,
                date: new Date(),
                cashier: req.user.username,
                notes: notes || 'Customer Payment'
            }
        });

        res.json({ msg: 'Payment successful', balance: updatedCustomer.balance, transaction: ledgerTx });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// ================= TENANT / TRIAL =================

router.get('/tenant/trial-status', auth, async (req, res) => {
    try {
        const tenant = await prisma.tenant.findUnique({ where: { id: req.tenantId } });
        if (!tenant) return res.status(404).json({ msg: 'Tenant not found' });

        const now = new Date();
        let effectiveEndDate = new Date(tenant.trialEndsAt);

        if (tenant.subscriptionEndsAt && new Date(tenant.subscriptionEndsAt) > effectiveEndDate) {
            effectiveEndDate = new Date(tenant.subscriptionEndsAt);
        }

        const diffTime = effectiveEndDate - now;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        const isExpired = diffTime < 0;

        res.json({ trialEndsAt: effectiveEndDate, daysRemaining: diffDays, isExpired });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// ================= SETTINGS =================

// @route   GET /api/settings
router.get('/settings', auth, async (req, res) => {
    try {
        const tenant = await prisma.tenant.findUnique({ where: { id: req.tenantId } });
        if (!tenant) return res.status(404).json({ msg: 'Tenant not found' });
        res.json({
            shopName: tenant.shopName,
            shopAddress: tenant.shopAddress,
            shopLogo: tenant.shopLogo,
            footerMessage: tenant.footerMessage,
            taxRate: tenant.taxRate,
            taxName: tenant.taxName
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   PUT /api/settings
router.put('/settings', auth, async (req, res) => {
    try {
        const tenant = await prisma.tenant.findUnique({ where: { id: req.tenantId } });
        if (!tenant) return res.status(404).json({ msg: 'Tenant not found' });

        const { shopName, shopAddress, shopLogo, footerMessage, taxRate, taxName } = req.body;

        const updated = await prisma.tenant.update({
            where: { id: req.tenantId },
            data: {
                ...(shopName !== undefined && { shopName }),
                ...(shopAddress !== undefined && { shopAddress }),
                ...(shopLogo !== undefined && { shopLogo }),
                ...(footerMessage !== undefined && { footerMessage }),
                ...(taxRate !== undefined && { taxRate: parseFloat(taxRate) }),
                ...(taxName !== undefined && { taxName })
            }
        });

        console.log('Saved Settings (v4-prisma):', updated);
        res.json({
            shopName: updated.shopName,
            shopAddress: updated.shopAddress,
            shopLogo: updated.shopLogo,
            footerMessage: updated.footerMessage,
            taxRate: updated.taxRate,
            taxName: updated.taxName,
            _backendVersion: 'v4-prisma'
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// ================= PRODUCTS =================

// @route   GET /api/products
router.get('/products', auth, async (req, res) => {
    try {
        const products = await prisma.product.findMany({
            where: { tenantId: req.tenantId }
        });
        res.json(products);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/products
router.post('/products', auth, async (req, res) => {
    try {
        const { cost, stock, stores, ...otherData } = req.body;
        const product = await prisma.product.create({
            data: {
                tenantId: req.tenantId,
                ...otherData,
                cost: 0,
                stock: 0,
                stores: []
            }
        });
        res.json(product);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   PUT /api/products/:id
router.put('/products/:id', auth, async (req, res) => {
    try {
        const product = await prisma.product.findFirst({
            where: { id: req.params.id, tenantId: req.tenantId }
        });
        if (!product) return res.status(404).json({ msg: 'Product not found' });

        const { name, barcode, price, priceOnline, priceDelivery, category, categoryEn, nameEn,
                minStock, trackStock, active, imageUrl, onlineActive } = req.body;

        const updated = await prisma.product.update({
            where: { id: req.params.id },
            data: {
                ...(name !== undefined && { name }),
                ...(barcode !== undefined && { barcode }),
                ...(price !== undefined && { price }),
                ...(priceOnline !== undefined && { priceOnline }),
                ...(priceDelivery !== undefined && { priceDelivery }),
                ...(category !== undefined && { category }),
                ...(categoryEn !== undefined && { categoryEn }),
                ...(nameEn !== undefined && { nameEn }),
                ...(minStock !== undefined && { minStock }),
                ...(trackStock !== undefined && { trackStock }),
                ...(active !== undefined && { active }),
                ...(imageUrl !== undefined && { imageUrl }),
                ...(onlineActive !== undefined && { onlineActive })
            }
        });
        res.json(updated);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   DELETE /api/products/:id
router.delete('/products/:id', auth, async (req, res) => {
    try {
        const product = await prisma.product.findFirst({
            where: { id: req.params.id, tenantId: req.tenantId }
        });
        if (!product) return res.status(404).json({ msg: 'Product not found' });

        await prisma.product.delete({ where: { id: req.params.id } });
        res.json({ msg: 'Product removed' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// ================= SALES =================

// Helper to update product stock
async function updateProductStock(tenantId, productId, barcode, qtyChange, storeId) {
    let product = null;
    if (productId) {
        product = await prisma.product.findFirst({ where: { id: productId, tenantId } });
    }
    if (!product && barcode) {
        product = await prisma.product.findFirst({ where: { barcode, tenantId } });
    }

    if (product && product.trackStock !== false) {
        const newStock = product.stock + qtyChange;
        const stores = Array.isArray(product.stores) ? product.stores : [];

        if (storeId) {
            const storeIdx = stores.findIndex(s => s.storeId === storeId);
            if (storeIdx >= 0) {
                stores[storeIdx].stock = (stores[storeIdx].stock || 0) + qtyChange;
            } else {
                stores.push({ storeId, stock: qtyChange });
            }
        }

        await prisma.product.update({
            where: { id: product.id },
            data: { stock: newStock, stores }
        });
    }
    return product;
}

// @route   POST /api/sales
router.post('/sales', auth, async (req, res) => {
    try {
        const { items, total, paymentMethod, salesman, orderType } = req.body;

        // Find active shift
        const shift = await prisma.shift.findFirst({
            where: {
                tenantId: req.tenantId,
                cashier: req.user.username,
                status: 'open'
            }
        });

        if (!shift) {
            return res.status(400).json({ msg: 'No open shift found. Please open a shift first.' });
        }

        // Generate Receipt ID based on shift count
        const shiftCount = await prisma.sale.count({ where: { shiftId: shift.id } });
        const receiptId = String(shiftCount + 1);

        const effectiveStoreId = req.body.storeId || shift.storeId;

        const sale = await prisma.sale.create({
            data: {
                tenantId: req.tenantId,
                storeId: effectiveStoreId,
                receiptId,
                shiftId: shift.id,
                date: new Date(),
                method: paymentMethod,
                orderType: orderType || 'instore',
                platform: req.body.platform || 'local',
                onlineOrderId: req.body.onlineOrderId || null,
                cashier: req.user.username,
                salesman: salesman || null,
                customerId: req.body.customerId || null,
                total,
                taxAmount: req.body.taxAmount || 0,
                taxName: req.body.taxName || null,
                taxRate: req.body.taxRate || null,
                items: items || [],
                splitPayments: req.body.splitPayments || []
            }
        });

        // Handle credit sales
        if (paymentMethod === 'credit') {
            if (!req.body.customerId) {
                return res.status(400).json({ msg: 'Customer ID is required for credit sales' });
            }
            const customer = await prisma.customer.findFirst({
                where: { id: req.body.customerId, tenantId: req.tenantId }
            });
            if (customer) {
                await prisma.customer.update({
                    where: { id: customer.id },
                    data: { balance: customer.balance + total }
                });
                await prisma.ledgerTransaction.create({
                    data: {
                        tenantId: req.tenantId,
                        entityType: 'customer',
                        entityId: customer.id,
                        type: 'sale',
                        amount: total,
                        referenceId: sale.id,
                        date: new Date(),
                        cashier: req.user.username,
                        notes: 'Credit Sale - Receipt: ' + receiptId
                    }
                });
            }
        }

        // Update stock for each item
        for (const item of items) {
            await updateProductStock(
                req.tenantId,
                item.productId || null,
                item.code || null,
                -item.qty,
                effectiveStoreId
            );
        }

        // Fetch tenant settings to return with sale
        const tenant = await prisma.tenant.findUnique({ where: { id: req.tenantId } });

        res.json({
            sale,
            settings: tenant ? {
                shopName: tenant.shopName,
                shopAddress: tenant.shopAddress,
                shopLogo: tenant.shopLogo,
                footerMessage: tenant.footerMessage,
                taxRate: tenant.taxRate,
                taxName: tenant.taxName
            } : {}
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/sales
router.get('/sales', auth, async (req, res) => {
    try {
        const sales = await prisma.sale.findMany({
            where: { tenantId: req.tenantId },
            orderBy: { date: 'desc' }
        });
        res.json(sales);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/sales/daily
router.get('/sales/daily', auth, async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const sales = await prisma.sale.findMany({
            where: {
                tenantId: req.tenantId,
                date: { gte: today }
            }
        });

        const totalSales = sales.reduce((acc, sale) => acc + sale.total, 0);
        const totalOrders = sales.length;

        res.json({ date: today, totalSales, totalOrders, sales });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/sales/:id
router.get('/sales/:id', auth, async (req, res) => {
    try {
        // Try by id first, then by receiptId
        let sale = await prisma.sale.findFirst({
            where: { id: req.params.id, tenantId: req.tenantId }
        });

        if (!sale) {
            sale = await prisma.sale.findFirst({
                where: { receiptId: req.params.id, tenantId: req.tenantId }
            });
        }

        if (!sale) return res.status(404).json({ msg: 'Sale not found' });
        res.json(sale);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/sales/:id/return
router.post('/sales/:id/return', auth, async (req, res) => {
    try {
        const { items } = req.body;

        let sale = await prisma.sale.findFirst({
            where: { id: req.params.id, tenantId: req.tenantId }
        });
        if (!sale) {
            sale = await prisma.sale.findFirst({
                where: { receiptId: req.params.id, tenantId: req.tenantId }
            });
        }
        if (!sale) return res.status(404).json({ msg: 'Sale not found' });

        const saleItems = Array.isArray(sale.items) ? sale.items : [];
        const returnRecord = {
            items: [],
            totalRefund: 0,
            cashier: req.user.username,
            date: new Date().toISOString()
        };

        for (const returnItem of items) {
            const saleItem = saleItems.find(i => i.code === returnItem.code || i._id === returnItem.code);
            if (!saleItem) continue;

            const remainingQty = saleItem.qty - (saleItem.returnedQty || 0);
            if (returnItem.qty > remainingQty) {
                return res.status(400).json({ msg: `Cannot return more than sold quantity for item ${saleItem.name}` });
            }

            saleItem.returnedQty = (saleItem.returnedQty || 0) + returnItem.qty;

            let itemPrice = saleItem.price;
            if (saleItem.discount) {
                if (saleItem.discount.type === 'percent') {
                    itemPrice = itemPrice - (itemPrice * saleItem.discount.value / 100);
                } else if (saleItem.discount.type === 'value') {
                    itemPrice = itemPrice - saleItem.discount.value;
                }
            }
            const refundAmount = itemPrice * returnItem.qty;

            returnRecord.items.push({
                code: saleItem.code,
                qty: returnItem.qty,
                refundAmount,
                reason: returnItem.reason || req.body.reason
            });
            returnRecord.totalRefund += refundAmount;

            // Restore product stock
            await updateProductStock(
                req.tenantId,
                saleItem.productId || null,
                saleItem.code || null,
                returnItem.qty,
                sale.storeId
            );
        }

        if (returnRecord.items.length > 0) {
            const returns = Array.isArray(sale.returns) ? [...sale.returns, returnRecord] : [returnRecord];
            const allReturned = saleItems.every(i => i.qty === (i.returnedQty || 0));

            const updated = await prisma.sale.update({
                where: { id: sale.id },
                data: {
                    items: saleItems,
                    returns,
                    status: allReturned ? 'returned' : 'partial_returned'
                }
            });
            res.json(updated);
        } else {
            res.status(400).json({ msg: 'No valid items to return' });
        }
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/sales/:id/cancel
router.post('/sales/:id/cancel', auth, async (req, res) => {
    try {
        const sale = await prisma.sale.findFirst({
            where: { id: req.params.id, tenantId: req.tenantId }
        });
        if (!sale) return res.status(404).json({ msg: 'Sale not found' });

        if (sale.status === 'cancelled') {
            return res.status(400).json({ msg: 'Sale already cancelled' });
        }

        // Restore stock for each item
        const saleItems = Array.isArray(sale.items) ? sale.items : [];
        for (const item of saleItems) {
            await updateProductStock(
                req.tenantId,
                item.productId || null,
                item.code || null,
                item.qty,
                sale.storeId
            );
        }

        await prisma.sale.update({
            where: { id: sale.id },
            data: {
                status: 'cancelled',
                returnReason: req.body.reason || 'Cancelled'
            }
        });

        // Log action
        await prisma.auditLog.create({
            data: {
                tenantId: req.tenantId,
                user: req.user.username,
                action: 'CANCEL_SALE',
                details: { saleId: sale.id, receiptId: sale.receiptId }
            }
        });

        res.json({ msg: 'Sale cancelled and stock restored' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// ================= SALESMEN =================

// @route   GET /api/salesmen
router.get('/salesmen', auth, async (req, res) => {
    try {
        const salesmen = await prisma.salesman.findMany({
            where: { tenantId: req.tenantId }
        });
        res.json(salesmen);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/salesmen
router.post('/salesmen', auth, async (req, res) => {
    try {
        const salesman = await prisma.salesman.create({
            data: {
                tenantId: req.tenantId,
                name: req.body.name,
                targets: req.body.targets || []
            }
        });
        res.json(salesman);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   PUT /api/salesmen/:id
router.put('/salesmen/:id', auth, async (req, res) => {
    try {
        const salesman = await prisma.salesman.findFirst({
            where: { id: req.params.id, tenantId: req.tenantId }
        });
        if (!salesman) return res.status(404).json({ msg: 'Salesman not found' });

        const updated = await prisma.salesman.update({
            where: { id: req.params.id },
            data: {
                ...(req.body.name !== undefined && { name: req.body.name }),
                ...(req.body.targets !== undefined && { targets: req.body.targets })
            }
        });
        res.json(updated);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   DELETE /api/salesmen/:id
router.delete('/salesmen/:id', auth, async (req, res) => {
    try {
        const salesman = await prisma.salesman.findFirst({
            where: { id: req.params.id, tenantId: req.tenantId }
        });
        if (!salesman) return res.status(404).json({ msg: 'Salesman not found' });

        await prisma.salesman.delete({ where: { id: req.params.id } });
        res.json({ msg: 'Salesman removed' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// ================= EXPENSES =================

// @route   GET /api/expenses
router.get('/expenses', auth, async (req, res) => {
    try {
        const expenses = await prisma.expense.findMany({
            where: { tenantId: req.tenantId }
        });
        res.json(expenses);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/expenses
router.post('/expenses', auth, async (req, res) => {
    try {
        const expense = await prisma.expense.create({
            data: { tenantId: req.tenantId, ...req.body }
        });
        res.json(expense);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   DELETE /api/expenses/:id
router.delete('/expenses/:id', auth, async (req, res) => {
    try {
        const expense = await prisma.expense.findFirst({
            where: { id: req.params.id, tenantId: req.tenantId }
        });
        if (!expense) return res.status(404).json({ msg: 'Expense not found' });

        await prisma.expense.delete({ where: { id: req.params.id } });
        res.json({ msg: 'Expense removed' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// ================= USERS =================

// @route   GET /api/users
router.get('/users', auth, async (req, res) => {
    try {
        const users = await prisma.user.findMany({
            where: { tenantId: req.tenantId },
            select: {
                id: true,
                tenantId: true,
                username: true,
                role: true,
                fullName: true,
                active: true,
                allowedStores: true,
                allowedPages: true,
                createdAt: true
            }
        });
        res.json(users);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/users
router.post('/users', auth, async (req, res) => {
    try {
        const { username, password, role, allowedStores, allowedPages } = req.body;

        const existing = await prisma.user.findFirst({
            where: { username, tenantId: req.tenantId }
        });
        if (existing) {
            return res.status(400).json({ msg: 'User already exists' });
        }

        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);

        await prisma.user.create({
            data: {
                tenantId: req.tenantId,
                username,
                passwordHash,
                fullName: username,
                role,
                allowedStores: allowedStores || [],
                allowedPages: allowedPages || []
            }
        });
        res.json({ msg: 'User created' });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ msg: 'Server Error: ' + err.message });
    }
});

// @route   PUT /api/users/:id
router.put('/users/:id', auth, async (req, res) => {
    try {
        const user = await prisma.user.findFirst({
            where: { id: req.params.id, tenantId: req.tenantId }
        });
        if (!user) return res.status(404).json({ msg: 'User not found' });

        const { role, allowedStores, allowedPages, password, active } = req.body;
        let passwordHash = undefined;

        if (password) {
            const salt = await bcrypt.genSalt(10);
            passwordHash = await bcrypt.hash(password, salt);
        }

        await prisma.user.update({
            where: { id: req.params.id },
            data: {
                ...(role !== undefined && { role }),
                ...(allowedStores !== undefined && { allowedStores }),
                ...(allowedPages !== undefined && { allowedPages }),
                ...(active !== undefined && { active }),
                ...(passwordHash !== undefined && { passwordHash })
            }
        });
        res.json({ msg: 'User updated successfully' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   DELETE /api/users/:id
router.delete('/users/:id', auth, async (req, res) => {
    try {
        const user = await prisma.user.findFirst({
            where: { id: req.params.id, tenantId: req.tenantId }
        });
        if (!user) return res.status(404).json({ msg: 'User not found' });

        await prisma.user.delete({ where: { id: req.params.id } });
        res.json({ msg: 'User removed' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// ================= CATEGORIES =================

// @route   GET /api/categories
router.get('/categories', auth, async (req, res) => {
    try {
        const categories = await prisma.category.findMany({
            where: { tenantId: req.tenantId },
            orderBy: { name: 'asc' }
        });
        res.json(categories);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/categories
router.post('/categories', auth, async (req, res) => {
    try {
        const category = await prisma.category.create({
            data: { tenantId: req.tenantId, ...req.body }
        });
        res.json(category);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   PUT /api/categories/:id
router.put('/categories/:id', auth, async (req, res) => {
    try {
        const category = await prisma.category.findFirst({
            where: { id: req.params.id, tenantId: req.tenantId }
        });
        if (!category) return res.status(404).json({ msg: 'Category not found' });

        const { name, nameEn } = req.body;
        const updated = await prisma.category.update({
            where: { id: req.params.id },
            data: {
                ...(name !== undefined && { name }),
                ...(nameEn !== undefined && { nameEn })
            }
        });
        res.json(updated);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   DELETE /api/categories/:id
router.delete('/categories/:id', auth, async (req, res) => {
    try {
        const category = await prisma.category.findFirst({
            where: { id: req.params.id, tenantId: req.tenantId }
        });
        if (!category) return res.status(404).json({ msg: 'Category not found' });

        await prisma.category.delete({ where: { id: req.params.id } });
        res.json({ msg: 'Category removed' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// ================= INVENTORY / STOCK ADJUSTMENT =================

// @route   POST /api/inventory/adjust
router.post('/inventory/adjust', auth, async (req, res) => {
    try {
        const { items, storeId } = req.body;
        if (!storeId) return res.status(400).json({ msg: 'Store is required for stock adjustment' });

        const adjustmentItems = [];

        for (const item of items) {
            const product = await prisma.product.findFirst({
                where: { id: item.productId, tenantId: req.tenantId }
            });
            if (product) {
                const oldStock = product.stock;
                const newStock = parseInt(item.newStock);
                const difference = newStock - oldStock;

                if (difference !== 0) {
                    const stores = Array.isArray(product.stores) ? product.stores : [];
                    const storeIdx = stores.findIndex(s => s.storeId === storeId);
                    if (storeIdx >= 0) {
                        stores[storeIdx].stock = (stores[storeIdx].stock || 0) + difference;
                    } else {
                        stores.push({ storeId, stock: difference });
                    }

                    await prisma.product.update({
                        where: { id: product.id },
                        data: { stock: newStock, stores }
                    });
                }

                adjustmentItems.push({
                    productId: product.id,
                    productName: product.name,
                    oldStock,
                    newStock,
                    difference,
                    reason: item.reason || 'Manual Adjustment'
                });
            }
        }

        if (adjustmentItems.length > 0) {
            const adjustment = await prisma.stockAdjustment.create({
                data: {
                    tenantId: req.tenantId,
                    storeId,
                    adjustedBy: req.user.username,
                    date: new Date(),
                    items: adjustmentItems
                }
            });
            res.json({ msg: 'Stock adjusted successfully', adjustment });
        } else {
            res.json({ msg: 'No changes made' });
        }
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// ================= SHIFT MANAGEMENT =================

// @route   GET /api/shifts/current
router.get('/shifts/current', auth, async (req, res) => {
    try {
        const user = await prisma.user.findUnique({ where: { id: req.user.id } });
        if (!user) return res.status(404).json({ msg: 'User not found' });

        const shift = await prisma.shift.findFirst({
            where: {
                tenantId: req.tenantId,
                cashier: user.username,
                status: 'open'
            }
        });
        res.json(shift);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/shifts/summary
router.get('/shifts/summary', auth, async (req, res) => {
    try {
        const user = await prisma.user.findUnique({ where: { id: req.user.id } });
        if (!user) return res.status(404).json({ msg: 'User not found' });

        const shift = await prisma.shift.findFirst({
            where: {
                tenantId: req.tenantId,
                cashier: user.username,
                status: 'open'
            }
        });

        if (!shift) return res.status(400).json({ msg: 'No open shift found' });

        const sales = await prisma.sale.findMany({
            where: { shiftId: shift.id, tenantId: req.tenantId }
        });

        let cashSales = 0, cardSales = 0, mobileSales = 0, totalSales = 0, totalRefunds = 0;

        sales.forEach(sale => {
            if (sale.status !== 'cancelled') {
                totalSales += sale.total;
                if (sale.method === 'cash') cashSales += sale.total;
                else if (sale.method === 'card') cardSales += sale.total;
                else if (sale.method === 'mobile') mobileSales += sale.total;
            }
            const returns = Array.isArray(sale.returns) ? sale.returns : [];
            returns.forEach(ret => { totalRefunds += ret.totalRefund || 0; });
        });

        const shiftDateStr = shift.startTime.toISOString().split('T')[0];
        const expenses = await prisma.expense.findMany({
            where: {
                tenantId: req.tenantId,
                date: { gte: shiftDateStr }
            }
        });
        const expensesTotal = expenses.reduce((acc, exp) => acc + exp.amount, 0);
        const expectedCash = shift.startCash + cashSales - totalRefunds - expensesTotal;

        res.json({ startCash: shift.startCash, cashSales, cardSales, mobileSales, totalSales, totalRefunds, expensesTotal, expectedCash });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/shifts/:id
router.get('/shifts/:id', auth, async (req, res) => {
    try {
        const shift = await prisma.shift.findUnique({ where: { id: req.params.id } });
        if (!shift) return res.status(404).json({ msg: 'Shift not found' });

        if (shift.tenantId !== req.tenantId) {
            return res.status(401).json({ msg: 'Not authorized' });
        }
        res.json(shift);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/shifts/open
router.post('/shifts/open', auth, async (req, res) => {
    try {
        const existingShift = await prisma.shift.findFirst({
            where: {
                tenantId: req.tenantId,
                cashier: req.user.username,
                status: 'open'
            }
        });

        if (existingShift) {
            return res.status(400).json({ msg: 'Shift already open' });
        }

        const { startCash, storeId } = req.body;
        if (!storeId) {
            return res.status(400).json({ msg: 'Store is required to open a shift' });
        }

        const user = await prisma.user.findUnique({ where: { id: req.user.id } });
        if (!user) return res.status(404).json({ msg: 'User not found' });

        // Validate store access for non-admins
        if (user.role !== 'admin' && user.allowedStores && user.allowedStores.length > 0) {
            const hasAccess = user.allowedStores.some(s => s === storeId);
            if (!hasAccess) return res.status(403).json({ msg: 'Access denied to this store' });
        }

        const newShift = await prisma.shift.create({
            data: {
                tenantId: req.tenantId,
                storeId,
                cashier: user.username,
                startCash: parseFloat(startCash) || 0,
                status: 'open',
                transactions: []
            }
        });

        // Log action
        await prisma.auditLog.create({
            data: {
                tenantId: req.tenantId,
                user: req.user.username,
                action: 'OPEN_SHIFT',
                details: { shiftId: newShift.id, startCash }
            }
        });

        res.json(newShift);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/shifts/close
router.post('/shifts/close', auth, async (req, res) => {
    try {
        const user = await prisma.user.findUnique({ where: { id: req.user.id } });
        if (!user) return res.status(404).json({ msg: 'User not found' });

        const shift = await prisma.shift.findFirst({
            where: {
                tenantId: req.tenantId,
                cashier: user.username,
                status: 'open'
            }
        });

        if (!shift) {
            return res.status(400).json({ msg: 'No open shift found' });
        }

        const { actualCash, actualCard, actualMobile } = req.body;

        const sales = await prisma.sale.findMany({
            where: { shiftId: shift.id, tenantId: req.tenantId }
        });

        let cashSales = 0, cardSales = 0, mobileSales = 0, totalSales = 0, totalRefunds = 0;

        sales.forEach(sale => {
            if (sale.status !== 'cancelled') {
                totalSales += sale.total;
                if (sale.method === 'cash') cashSales += sale.total;
                else if (sale.method === 'card') cardSales += sale.total;
                else if (sale.method === 'mobile') mobileSales += sale.total;
            }
            const returns = Array.isArray(sale.returns) ? sale.returns : [];
            returns.forEach(ret => { totalRefunds += ret.totalRefund || 0; });
        });

        const shiftDateStr = shift.startTime.toISOString().split('T')[0];
        const expenses = await prisma.expense.findMany({
            where: {
                tenantId: req.tenantId,
                date: { gte: shiftDateStr }
            }
        });
        const expensesTotal = expenses.reduce((acc, exp) => acc + exp.amount, 0);
        const expectedCash = shift.startCash + cashSales - totalRefunds - expensesTotal;

        const closedShift = await prisma.shift.update({
            where: { id: shift.id },
            data: {
                status: 'closed',
                endTime: new Date(),
                actualCash: parseFloat(actualCash) || 0,
                actualCard: parseFloat(actualCard) || 0,
                actualMobile: parseFloat(actualMobile) || 0,
                endCash: expectedCash,
                totalSales,
                cashSales,
                cardSales,
                mobileSales,
                returnsTotal: totalRefunds,
                expensesTotal
            }
        });

        // Log action
        await prisma.auditLog.create({
            data: {
                tenantId: req.tenantId,
                user: req.user.username,
                action: 'CLOSE_SHIFT',
                details: { shiftId: shift.id, actualCash, expectedCash, diff: (actualCash || 0) - expectedCash }
            }
        });

        res.json(closedShift);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// ================= AUDIT LOGS =================

// @route   GET /api/audit-logs
router.get('/audit-logs', auth, async (req, res) => {
    try {
        if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
            return res.status(403).json({ msg: 'Access denied' });
        }

        const logs = await prisma.auditLog.findMany({
            where: { tenantId: req.tenantId },
            orderBy: { timestamp: 'desc' },
            take: 100
        });
        res.json(logs);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// ================= SUPPLIERS =================

// @route   GET /api/suppliers
router.get('/suppliers', auth, async (req, res) => {
    try {
        const suppliers = await prisma.supplier.findMany({
            where: { tenantId: req.tenantId }
        });
        res.json(suppliers);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/suppliers
router.post('/suppliers', auth, async (req, res) => {
    try {
        const supplier = await prisma.supplier.create({
            data: { tenantId: req.tenantId, ...req.body }
        });
        res.json(supplier);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   PUT /api/suppliers/:id
router.put('/suppliers/:id', auth, async (req, res) => {
    try {
        const supplier = await prisma.supplier.findFirst({
            where: { id: req.params.id, tenantId: req.tenantId }
        });
        if (!supplier) return res.status(404).json({ msg: 'Supplier not found' });

        const { name, phone, address, balance } = req.body;
        const updated = await prisma.supplier.update({
            where: { id: req.params.id },
            data: {
                ...(name !== undefined && { name }),
                ...(phone !== undefined && { phone }),
                ...(address !== undefined && { address }),
                ...(balance !== undefined && { balance })
            }
        });
        res.json(updated);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   DELETE /api/suppliers/:id
router.delete('/suppliers/:id', auth, async (req, res) => {
    try {
        const supplier = await prisma.supplier.findFirst({
            where: { id: req.params.id, tenantId: req.tenantId }
        });
        if (!supplier) return res.status(404).json({ msg: 'Supplier not found' });

        await prisma.supplier.delete({ where: { id: req.params.id } });
        res.json({ msg: 'Supplier removed' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/suppliers/:id/statement
router.get('/suppliers/:id/statement', auth, async (req, res) => {
    try {
        const transactions = await prisma.ledgerTransaction.findMany({
            where: {
                tenantId: req.tenantId,
                entityType: 'supplier',
                entityId: req.params.id
            },
            orderBy: { date: 'desc' }
        });
        res.json(transactions);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/suppliers/:id/pay
router.post('/suppliers/:id/pay', auth, async (req, res) => {
    try {
        const { amount, notes } = req.body;
        if (!amount || amount <= 0) return res.status(400).json({ msg: 'Valid amount missing' });

        const supplier = await prisma.supplier.findFirst({
            where: { id: req.params.id, tenantId: req.tenantId }
        });
        if (!supplier) return res.status(404).json({ msg: 'Supplier not found' });

        const updatedSupplier = await prisma.supplier.update({
            where: { id: supplier.id },
            data: { balance: supplier.balance - amount }
        });

        const ledgerTx = await prisma.ledgerTransaction.create({
            data: {
                tenantId: req.tenantId,
                entityType: 'supplier',
                entityId: supplier.id,
                type: 'payment',
                amount: -amount,
                date: new Date(),
                cashier: req.user.username,
                notes: notes || 'Payment to Supplier'
            }
        });

        res.json({ msg: 'Payment successful', balance: updatedSupplier.balance, transaction: ledgerTx });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// ================= PURCHASES =================

// @route   POST /api/purchases
router.post('/purchases', auth, async (req, res) => {
    try {
        const { supplierId, items, total, cashPaid } = req.body;

        const supplier = await prisma.supplier.findFirst({
            where: { id: supplierId, tenantId: req.tenantId }
        });
        if (!supplier) return res.status(404).json({ msg: 'Supplier not found' });

        const purchaseCount = await prisma.purchase.count({ where: { tenantId: req.tenantId } });
        const receiptId = 'PUR-' + (purchaseCount + 1);

        const purchase = await prisma.purchase.create({
            data: {
                tenantId: req.tenantId,
                storeId: req.body.storeId,
                supplierId,
                receiptId,
                date: new Date(),
                total,
                cashPaid: cashPaid || 0,
                items: items || [],
                cashier: req.user.username
            }
        });

        // Update Supplier Balance & Ledger
        const owedAmount = total - (cashPaid || 0);

        if (owedAmount > 0) {
            await prisma.supplier.update({
                where: { id: supplier.id },
                data: { balance: supplier.balance + owedAmount }
            });

            await prisma.ledgerTransaction.create({
                data: {
                    tenantId: req.tenantId,
                    entityType: 'supplier',
                    entityId: supplier.id,
                    type: 'purchase',
                    amount: owedAmount,
                    referenceId: purchase.id,
                    date: new Date(),
                    cashier: req.user.username,
                    notes: 'Purchase - Receipt: ' + receiptId + (cashPaid > 0 ? ` (Total: ${total}, Paid: ${cashPaid})` : '')
                }
            });
        }

        // Update stock for each item
        for (const item of items) {
            let product = null;
            if (item.productId) {
                product = await prisma.product.findFirst({ where: { id: item.productId, tenantId: req.tenantId } });
            }
            if (!product && item.code) {
                product = await prisma.product.findFirst({ where: { barcode: item.code, tenantId: req.tenantId } });
            }

            if (product && product.trackStock !== false) {
                const oldStock = Math.max(0, product.stock);
                const newQty = item.qty;
                const newCost = item.cost || 0;
                const oldCost = product.cost || 0;

                let updatedCost = product.cost;
                if (oldStock + newQty > 0) {
                    updatedCost = ((oldStock * oldCost) + (newQty * newCost)) / (oldStock + newQty);
                } else {
                    updatedCost = newCost;
                }

                const stores = Array.isArray(product.stores) ? product.stores : [];
                const storeId = req.body.storeId;
                const storeIdx = stores.findIndex(s => s.storeId === storeId);
                if (storeIdx >= 0) {
                    stores[storeIdx].stock = (stores[storeIdx].stock || 0) + newQty;
                } else {
                    stores.push({ storeId, stock: newQty });
                }

                await prisma.product.update({
                    where: { id: product.id },
                    data: {
                        stock: product.stock + newQty,
                        cost: updatedCost,
                        stores
                    }
                });
            }
        }

        // Re-fetch updated supplier balance
        const updatedSupplier = await prisma.supplier.findUnique({ where: { id: supplier.id } });
        res.json({ purchase, supplierBalance: updatedSupplier.balance });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/purchases
router.get('/purchases', auth, async (req, res) => {
    try {
        const purchases = await prisma.purchase.findMany({
            where: { tenantId: req.tenantId },
            include: { supplier: { select: { id: true, name: true, phone: true } } },
            orderBy: { date: 'desc' }
        });
        res.json(purchases);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;
