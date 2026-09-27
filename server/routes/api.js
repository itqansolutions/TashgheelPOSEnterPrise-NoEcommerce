const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const bcrypt = require('bcryptjs');
const prisma = require('../prisma');
const { acquireStoreInventoryLock } = require('../services/inventoryLock.service');
const inventoryMutationService = require('../services/inventoryMutation.service');

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
        // Enforce plan branch limit
        const tenant = await prisma.tenant.findUnique({ where: { id: req.tenantId } });
        const branchCount = await prisma.store.count({ where: { tenantId: req.tenantId } });
        if (branchCount >= (tenant.maxBranches || 3)) {
            return res.status(403).json({ msg: `Branch limit reached. Your plan allows ${tenant.maxBranches} branches.`, code: 'BRANCH_LIMIT' });
        }
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

        const { name, location, phone } = req.body;
        const updated = await prisma.store.update({
            where: { id: req.params.id },
            data: {
                ...(name !== undefined && { name }),
                ...(location !== undefined && { location }),
                ...(phone !== undefined && { phone })
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
            taxName: tenant.taxName,
            managerPasswordSet: !!tenant.managerPassword,
            maxBranches: tenant.maxBranches,
            maxUsers: tenant.maxUsers
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

        const { shopName, shopAddress, shopLogo, footerMessage, taxRate, taxName, managerPassword } = req.body;

        // Hash manager password if provided
        let hashedManagerPassword = undefined;
        if (managerPassword && managerPassword.length >= 4) {
            const salt = await bcrypt.genSalt(10);
            hashedManagerPassword = await bcrypt.hash(managerPassword, salt);
        }

        const updated = await prisma.tenant.update({
            where: { id: req.tenantId },
            data: {
                ...(shopName !== undefined && { shopName }),
                ...(shopAddress !== undefined && { shopAddress }),
                ...(shopLogo !== undefined && { shopLogo }),
                ...(footerMessage !== undefined && { footerMessage }),
                ...(taxRate !== undefined && { taxRate: parseFloat(taxRate) }),
                ...(taxName !== undefined && { taxName }),
                ...(hashedManagerPassword !== undefined && { managerPassword: hashedManagerPassword })
            }
        });

        console.log('Saved Settings (v4-prisma):', updated.shopName);
        res.json({
            shopName: updated.shopName,
            shopAddress: updated.shopAddress,
            shopLogo: updated.shopLogo,
            footerMessage: updated.footerMessage,
            taxRate: updated.taxRate,
            taxName: updated.taxName,
            managerPasswordSet: !!updated.managerPassword,
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
        const { storeId } = req.query;
        const products = await prisma.product.findMany({
            where: { tenantId: req.tenantId },
            include: {
                variantStocks: storeId ? { where: { storeId: String(storeId) } } : true
            }
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
                minStock, trackStock, active, imageUrl, onlineActive, hasVariants, variants,
                priceAmazon, priceNoon, priceJumia, priceWooCommerce } = req.body;

        const updated = await prisma.product.update({
            where: { id: req.params.id },
            data: {
                ...(name !== undefined && { name }),
                ...(barcode !== undefined && { barcode }),
                ...(price !== undefined && { price }),
                ...(priceOnline !== undefined && { priceOnline }),
                ...(priceDelivery !== undefined && { priceDelivery }),
                ...(priceAmazon !== undefined && { priceAmazon }),
                ...(priceNoon !== undefined && { priceNoon }),
                ...(priceJumia !== undefined && { priceJumia }),
                ...(priceWooCommerce !== undefined && { priceWooCommerce }),
                ...(category !== undefined && { category }),
                ...(categoryEn !== undefined && { categoryEn }),
                ...(nameEn !== undefined && { nameEn }),
                ...(minStock !== undefined && { minStock }),
                ...(trackStock !== undefined && { trackStock }),
                ...(active !== undefined && { active }),
                ...(imageUrl !== undefined && { imageUrl }),
                ...(onlineActive !== undefined && { onlineActive }),
                ...(hasVariants !== undefined && { hasVariants }),
                ...(variants !== undefined && { variants })
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

        let createdSale = null;

        await prisma.$transaction(async (tx) => {
            if (effectiveStoreId) {
                await acquireStoreInventoryLock(tx, effectiveStoreId);
            }

            createdSale = await tx.sale.create({
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
            if (paymentMethod === 'credit' && req.body.customerId) {
                const customer = await tx.customer.findFirst({
                    where: { id: req.body.customerId, tenantId: req.tenantId }
                });
                if (customer) {
                    await tx.customer.update({
                        where: { id: customer.id },
                        data: { balance: customer.balance + total }
                    });
                    await tx.ledgerTransaction.create({
                        data: {
                            tenantId: req.tenantId,
                            entityType: 'customer',
                            entityId: customer.id,
                            type: 'sale',
                            amount: total,
                            referenceId: createdSale.id,
                            date: new Date(),
                            cashier: req.user.username,
                            notes: 'Credit Sale - Receipt: ' + receiptId
                        }
                    });
                }
            }

            // Authoritative Inventory Deduction via Centralized Service
            if (effectiveStoreId && Array.isArray(items) && items.length > 0) {
                await inventoryMutationService.recordSale(tx, {
                    tenantId: req.tenantId,
                    storeId: effectiveStoreId,
                    saleId: createdSale.id,
                    items,
                    performedBy: req.user.username,
                    notes: `Sale Receipt: ${receiptId}`
                });
            }
        });

        // Fetch tenant settings to return with sale
        const tenant = await prisma.tenant.findUnique({ where: { id: req.tenantId } });

        res.json({
            sale: createdSale,
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
        if (err.statusCode === 423 || err.code === 'STORE_LOCKED_FOR_RECONCILIATION') {
            return res.status(423).json({ msg: err.message, code: err.code });
        }
        console.error(err.message);
        res.status(err.statusCode || 500).json({ msg: err.message || 'Server Error' });
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

        let updatedSale = null;

        await prisma.$transaction(async (tx) => {
            let sale = await tx.sale.findFirst({
                where: { id: req.params.id, tenantId: req.tenantId }
            });
            if (!sale) {
                sale = await tx.sale.findFirst({
                    where: { receiptId: req.params.id, tenantId: req.tenantId }
                });
            }
            if (!sale) {
                const notFound = new Error('Sale not found');
                notFound.statusCode = 404;
                throw notFound;
            }

            if (sale.storeId) {
                await acquireStoreInventoryLock(tx, sale.storeId);
            }

            const saleItems = Array.isArray(sale.items) ? sale.items : [];
            const returnRecord = {
                items: [],
                totalRefund: 0,
                cashier: req.user.username,
                date: new Date().toISOString()
            };
            const itemsToRestore = [];

            for (const returnItem of items) {
                const saleItem = saleItems.find(i => 
                    (returnItem.variantId && i.variantId === returnItem.variantId) ||
                    i.code === returnItem.code || 
                    i._id === returnItem.code ||
                    (returnItem.code && (i.variantId === returnItem.code || i.barcode === returnItem.code || i.sku === returnItem.code))
                );
                if (!saleItem) continue;

                const remainingQty = saleItem.qty - (saleItem.returnedQty || 0);
                if (returnItem.qty > remainingQty) {
                    const badQtyErr = new Error(`Cannot return more than sold quantity for item ${saleItem.name}`);
                    badQtyErr.statusCode = 400;
                    throw badQtyErr;
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

                itemsToRestore.push({
                    productId: saleItem.productId || null,
                    barcode: saleItem.barcode || saleItem.code || null,
                    code: saleItem.code || null,
                    qty: returnItem.qty,
                    variantId: saleItem.variantId || null
                });
            }

            if (returnRecord.items.length === 0) {
                const noValidErr = new Error('No valid items to return');
                noValidErr.statusCode = 400;
                throw noValidErr;
            }

            // Restore stock via centralized inventory mutation service
            if (sale.storeId && itemsToRestore.length > 0) {
                const returnRefId = 'RET_' + sale.id + '_' + Date.now();
                await inventoryMutationService.recordReturn(tx, {
                    tenantId: req.tenantId,
                    storeId: sale.storeId,
                    returnId: returnRefId,
                    saleId: sale.id,
                    items: itemsToRestore,
                    performedBy: req.user.username,
                    notes: `Return for receipt ${sale.receiptId}`
                });
            }

            const returns = Array.isArray(sale.returns) ? [...sale.returns, returnRecord] : [returnRecord];
            const allReturned = saleItems.every(i => i.qty === (i.returnedQty || 0));

            updatedSale = await tx.sale.update({
                where: { id: sale.id },
                data: {
                    items: saleItems,
                    returns,
                    status: allReturned ? 'returned' : 'partial_returned'
                }
            });
        });

        res.json(updatedSale);
    } catch (err) {
        if (err.statusCode === 423 || err.code === 'STORE_LOCKED_FOR_RECONCILIATION') {
            return res.status(423).json({ msg: err.message, code: err.code });
        }
        console.error(err.message);
        res.status(err.statusCode || 500).json({ msg: err.message || 'Server Error' });
    }
});

// @route   POST /api/sales/:id/cancel
router.post('/sales/:id/cancel', auth, async (req, res) => {
    try {
        await prisma.$transaction(async (tx) => {
            const sale = await tx.sale.findFirst({
                where: { id: req.params.id, tenantId: req.tenantId }
            });
            if (!sale) {
                const notFound = new Error('Sale not found');
                notFound.statusCode = 404;
                throw notFound;
            }

            if (sale.storeId) {
                await acquireStoreInventoryLock(tx, sale.storeId);
            }

            if (sale.status === 'cancelled') {
                const alreadyCancelled = new Error('Sale already cancelled');
                alreadyCancelled.statusCode = 400;
                throw alreadyCancelled;
            }

            const saleItems = Array.isArray(sale.items) ? sale.items : [];
            if (sale.storeId && saleItems.length > 0) {
                await inventoryMutationService.recordCancelSale(tx, {
                    tenantId: req.tenantId,
                    storeId: sale.storeId,
                    cancelId: 'CANCEL_' + sale.id,
                    saleId: sale.id,
                    items: saleItems,
                    performedBy: req.user.username,
                    notes: `Cancelled sale ${sale.receiptId}: ${req.body.reason || 'Cancelled'}`
                });
            }

            await tx.sale.update({
                where: { id: sale.id },
                data: {
                    status: 'cancelled',
                    returnReason: req.body.reason || 'Cancelled'
                }
            });

            await tx.auditLog.create({
                data: {
                    tenantId: req.tenantId,
                    user: req.user.username,
                    action: 'CANCEL_SALE',
                    details: { saleId: sale.id, receiptId: sale.receiptId }
                }
            });
        });

        res.json({ msg: 'Sale cancelled and stock restored' });
    } catch (err) {
        if (err.statusCode === 423 || err.code === 'STORE_LOCKED_FOR_RECONCILIATION') {
            return res.status(423).json({ msg: err.message, code: err.code });
        }
        console.error(err.message);
        res.status(err.statusCode || 500).json({ msg: err.message || 'Server Error' });
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
                jobTitle: req.body.jobTitle || null,
                phone: req.body.phone || null,
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
                ...(req.body.jobTitle !== undefined && { jobTitle: req.body.jobTitle }),
                ...(req.body.phone !== undefined && { phone: req.body.phone }),
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
        const { username, password, role, fullName, allowedStores, allowedPages } = req.body;

        // Enforce plan user limit
        const tenant = await prisma.tenant.findUnique({ where: { id: req.tenantId } });
        const userCount = await prisma.user.count({ where: { tenantId: req.tenantId } });
        if (userCount >= (tenant.maxUsers || 10)) {
            return res.status(403).json({ msg: `User limit reached. Your plan allows ${tenant.maxUsers} users.`, code: 'USER_LIMIT' });
        }

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
                fullName: fullName || username,
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
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ msg: 'Items array is required' });
        }

        let createdAdjustment = null;

        await prisma.$transaction(async (tx) => {
            await acquireStoreInventoryLock(tx, storeId);

            const adjustmentId = 'ADJ_' + Date.now();
            const mutationResult = await inventoryMutationService.recordAdjustment(tx, {
                tenantId: req.tenantId,
                storeId,
                adjustmentId,
                items,
                performedBy: req.user.username,
                notes: 'Manual Stock Adjustment'
            });

            const adjustmentItems = [];
            for (const m of (mutationResult.movements || [])) {
                let prodName = 'Product';
                const p = await tx.product.findUnique({ where: { id: m.productId } });
                if (p) prodName = p.name;

                adjustmentItems.push({
                    productId: m.productId,
                    productName: prodName,
                    variantId: m.variantId || null,
                    oldStock: m.quantityBefore,
                    newStock: m.quantityAfter,
                    difference: m.quantityDelta,
                    reason: m.notes || 'Manual Adjustment'
                });
            }

            if (adjustmentItems.length > 0) {
                createdAdjustment = await tx.stockAdjustment.create({
                    data: {
                        tenantId: req.tenantId,
                        storeId,
                        adjustedBy: req.user.username,
                        date: new Date(),
                        items: adjustmentItems
                    }
                });
            }
        });

        if (createdAdjustment) {
            res.json({ msg: 'Stock adjusted successfully', adjustment: createdAdjustment });
        } else {
            res.json({ msg: 'No changes made' });
        }
    } catch (err) {
        if (err.statusCode === 423 || err.code === 'STORE_LOCKED_FOR_RECONCILIATION') {
            return res.status(423).json({ msg: err.message, code: err.code });
        }
        console.error(err.message);
        res.status(err.statusCode || 500).json({ msg: err.message || 'Server Error' });
    }
});

// @route   GET /api/inventory/store-stock
// @desc    Get real-time authoritative stock for a warehouse directly from VariantStock
router.get('/inventory/store-stock', auth, async (req, res) => {
    try {
        const { storeId } = req.query;
        if (!storeId) {
            return res.status(400).json({ msg: 'storeId is required' });
        }

        const stocks = await prisma.variantStock.findMany({
            where: { tenantId: req.tenantId, storeId: String(storeId) }
        });

        res.json({ storeId, stocks });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/inventory/movements
// @desc    Get paginated inventory movements ledger
router.get('/inventory/movements', auth, async (req, res) => {
    try {
        const { storeId, productId, variantId, limit = 50, page = 1 } = req.query;
        const take = Math.min(100, Math.max(1, parseInt(limit) || 50));
        const skip = (Math.max(1, parseInt(page) || 1) - 1) * take;

        const where = {
            tenantId: req.tenantId,
            ...(storeId && { storeId: String(storeId) }),
            ...(productId && { productId: String(productId) }),
            ...(variantId && { variantId: String(variantId) })
        };

        const [movements, total] = await Promise.all([
            prisma.inventoryMovement.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                take,
                skip,
                include: {
                    product: { select: { id: true, name: true, barcode: true } },
                    store: { select: { id: true, name: true } }
                }
            }),
            prisma.inventoryMovement.count({ where })
        ]);

        res.json({ movements, total, page: parseInt(page) || 1, limit: take });
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
        const { supplierId, items, total, cashPaid, storeId } = req.body;

        const supplier = await prisma.supplier.findFirst({
            where: { id: supplierId, tenantId: req.tenantId }
        });
        if (!supplier) return res.status(404).json({ msg: 'Supplier not found' });

        let createdPurchase = null;
        let finalSupplierBalance = 0;

        await prisma.$transaction(async (tx) => {
            if (storeId) {
                await acquireStoreInventoryLock(tx, storeId);
            }

            const purchaseCount = await tx.purchase.count({ where: { tenantId: req.tenantId } });
            const receiptId = 'PUR-' + (purchaseCount + 1);

            createdPurchase = await tx.purchase.create({
                data: {
                    tenantId: req.tenantId,
                    storeId,
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
                await tx.supplier.update({
                    where: { id: supplier.id },
                    data: { balance: supplier.balance + owedAmount }
                });

                await tx.ledgerTransaction.create({
                    data: {
                        tenantId: req.tenantId,
                        entityType: 'supplier',
                        entityId: supplier.id,
                        type: 'purchase',
                        amount: owedAmount,
                        referenceId: createdPurchase.id,
                        date: new Date(),
                        cashier: req.user.username,
                        notes: 'Purchase - Receipt: ' + receiptId + (cashPaid > 0 ? ` (Total: ${total}, Paid: ${cashPaid})` : '')
                    }
                });
            }

            // Centralized Inventory Mutation
            if (storeId && Array.isArray(items) && items.length > 0) {
                await inventoryMutationService.recordPurchase(tx, {
                    tenantId: req.tenantId,
                    storeId,
                    purchaseId: createdPurchase.id,
                    items,
                    performedBy: req.user.username,
                    notes: `Purchase: ${receiptId}`
                });
            }

            const updatedSupplier = await tx.supplier.findUnique({ where: { id: supplier.id } });
            finalSupplierBalance = updatedSupplier ? updatedSupplier.balance : 0;
        });

        res.json({ purchase: createdPurchase, supplierBalance: finalSupplierBalance });
    } catch (err) {
        if (err.statusCode === 423 || err.code === 'STORE_LOCKED_FOR_RECONCILIATION') {
            return res.status(423).json({ msg: err.message, code: err.code });
        }
        console.error(err.message);
        res.status(err.statusCode || 500).json({ msg: err.message || 'Server Error' });
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

// ================= MANAGER PASSWORD =================
// POST /api/verify-manager-password
router.post('/verify-manager-password', auth, async (req, res) => {
    try {
        const { password } = req.body;
        if (!password) return res.status(400).json({ msg: 'Password required' });
        
        const tenant = await prisma.tenant.findUnique({ where: { id: req.tenantId } });
        if (!tenant || !tenant.managerPassword) {
            return res.status(400).json({ msg: 'Manager password not configured', code: 'NO_MANAGER_PASSWORD' });
        }
        
        const isMatch = await bcrypt.compare(password, tenant.managerPassword);
        if (!isMatch) return res.status(401).json({ msg: 'Incorrect manager password', code: 'WRONG_PASSWORD' });
        
        res.json({ valid: true });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// ================= PRICE LIST =================
router.get('/price-list', auth, async (req, res) => {
    try {
        const { storeId, search } = req.query;
        const products = await prisma.product.findMany({
            where: {
                tenantId: req.tenantId,
                active: true,
                ...(search && {
                    OR: [
                        { name: { contains: search, mode: 'insensitive' } },
                        { barcode: { contains: search, mode: 'insensitive' } }
                    ]
                })
            },
            orderBy: { name: 'asc' }
        });
        
        // If storeId filter, return only that store's stock
        const result = products.map(p => ({
            id: p.id,
            name: p.name,
            barcode: p.barcode,
            category: p.category,
            price: p.price,
            cost: p.cost,
            stock: storeId
                ? ((Array.isArray(p.stores) ? p.stores : []).find(s => s.storeId === storeId)?.stock ?? 0)
                : p.stock,
            stores: p.stores,
            hasVariants: p.hasVariants,
            variants: p.variants,
            minStock: p.minStock
        }));
        
        res.json(result);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// PUT /api/price-list/:id — update selling price only
router.put('/price-list/:id', auth, async (req, res) => {
    try {
        const { price } = req.body;
        if (price === undefined || isNaN(price)) return res.status(400).json({ msg: 'Valid price required' });
        
        const product = await prisma.product.findFirst({
            where: { id: req.params.id, tenantId: req.tenantId }
        });
        if (!product) return res.status(404).json({ msg: 'Product not found' });
        
        const updated = await prisma.product.update({
            where: { id: req.params.id },
            data: { price: parseFloat(price) }
        });
        
        await prisma.auditLog.create({
            data: {
                tenantId: req.tenantId,
                user: req.user.username,
                action: 'UPDATE_PRICE',
                details: { productId: product.id, productName: product.name, oldPrice: product.price, newPrice: parseFloat(price) }
            }
        });
        
        res.json(updated);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// ================= PLAN LIMIT HELPERS =================
// GET /api/limits — return current usage vs plan limits
router.get('/limits', auth, async (req, res) => {
    try {
        const tenant = await prisma.tenant.findUnique({ where: { id: req.tenantId } });
        const branchCount = await prisma.store.count({ where: { tenantId: req.tenantId } });
        const userCount = await prisma.user.count({ where: { tenantId: req.tenantId } });
        res.json({
            branches: { used: branchCount, max: tenant.maxBranches },
            users: { used: userCount, max: tenant.maxUsers }
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;
