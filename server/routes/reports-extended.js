const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const prisma = require('../prisma');

// ================= EXTENDED REPORTS =================

// Helper: restrict to admin/manager
function requirePrivileged(req, res, next) {
    const role = req.user.role;
    if (role !== 'admin' && role !== 'manager') {
        return res.status(403).json({ msg: 'Access denied' });
    }
    next();
}

// Helper: build date range filter
function buildDateFilter(from, to) {
    const filter = {};
    if (from) filter.gte = new Date(from);
    if (to) {
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        filter.lte = toDate;
    }
    return Object.keys(filter).length > 0 ? filter : undefined;
}

// @route   GET /api/reports/ar-aging
// @desc    Accounts Receivable Aging report
router.get('/ar-aging', auth, requirePrivileged, async (req, res) => {
    try {
        const customers = await prisma.customer.findMany({
            where: {
                tenantId: req.tenantId,
                balance: { gt: 0 }
            }
        });

        const buckets = { '0-10': [], '11-30': [], '31-60': [], '60+': [] };
        const totals = { '0-10': 0, '11-30': 0, '31-60': 0, '60+': 0 };
        const now = new Date();

        for (const customer of customers) {
            // Find oldest unpaid sale for this customer
            const ledgerTxs = await prisma.ledgerTransaction.findMany({
                where: {
                    tenantId: req.tenantId,
                    entityType: 'customer',
                    entityId: customer.id,
                    type: 'sale'
                },
                orderBy: { date: 'asc' }
            });

            const oldestTx = ledgerTxs[0];
            let daysDiff = 0;
            if (oldestTx) {
                daysDiff = Math.floor((now - new Date(oldestTx.date)) / (1000 * 60 * 60 * 24));
            }

            const entry = { customerId: customer.id, customer: customer.name, phone: customer.phone, amount: customer.balance };

            if (daysDiff <= 10) {
                buckets['0-10'].push(entry);
                totals['0-10'] += customer.balance;
            } else if (daysDiff <= 30) {
                buckets['11-30'].push(entry);
                totals['11-30'] += customer.balance;
            } else if (daysDiff <= 60) {
                buckets['31-60'].push(entry);
                totals['31-60'] += customer.balance;
            } else {
                buckets['60+'].push(entry);
                totals['60+'] += customer.balance;
            }
        }

        res.json({ buckets, totals });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/reports/discounts
// @desc    Discounts report grouped by cashier
router.get('/discounts', auth, requirePrivileged, async (req, res) => {
    try {
        const { from, to, storeId, cashier } = req.query;

        const dateFilter = buildDateFilter(from, to);

        const where = {
            tenantId: req.tenantId,
            ...(dateFilter && { date: dateFilter }),
            ...(storeId && { storeId }),
            ...(cashier && { cashier })
        };

        const sales = await prisma.sale.findMany({
            where,
            select: { cashier: true, items: true, id: true }
        });

        const cashierMap = {};

        for (const sale of sales) {
            const items = Array.isArray(sale.items) ? sale.items : [];
            let saleDiscount = 0;

            for (const item of items) {
                if (item.discount) {
                    if (item.discount.type === 'percent') {
                        saleDiscount += (item.price * item.qty) * (item.discount.value / 100);
                    } else if (item.discount.type === 'value') {
                        saleDiscount += item.discount.value * (item.qty || 1);
                    }
                }
            }

            if (!cashierMap[sale.cashier]) {
                cashierMap[sale.cashier] = { cashier: sale.cashier, totalDiscount: 0, invoiceCount: 0 };
            }
            cashierMap[sale.cashier].totalDiscount += saleDiscount;
            cashierMap[sale.cashier].invoiceCount += 1;
        }

        const rows = Object.values(cashierMap);
        const total = rows.reduce((sum, r) => sum + r.totalDiscount, 0);

        res.json({ rows, total });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/reports/returns
// @desc    Returns report
router.get('/returns', auth, requirePrivileged, async (req, res) => {
    try {
        const { from, to, productCode } = req.query;

        const dateFilter = buildDateFilter(from, to);

        const sales = await prisma.sale.findMany({
            where: {
                tenantId: req.tenantId,
                status: { in: ['returned', 'partial_returned'] },
                ...(dateFilter && { date: dateFilter })
            },
            select: { id: true, receiptId: true, cashier: true, date: true, returns: true, items: true, storeId: true }
        });

        const rows = [];
        let totalRefund = 0;

        for (const sale of sales) {
            const returns = Array.isArray(sale.returns) ? sale.returns : [];
            const saleItems = Array.isArray(sale.items) ? sale.items : [];

            for (const ret of returns) {
                const retItems = Array.isArray(ret.items) ? ret.items : [];
                for (const retItem of retItems) {
                    if (productCode && retItem.code !== productCode) continue;

                    const originalItem = saleItems.find(i => i.code === retItem.code);
                    rows.push({
                        date: ret.date,
                        receiptId: sale.receiptId,
                        cashier: sale.cashier,
                        itemCode: retItem.code,
                        itemName: originalItem ? originalItem.name : retItem.code,
                        qty: retItem.qty,
                        refundAmount: retItem.refundAmount || 0,
                        reason: retItem.reason || null
                    });
                    totalRefund += retItem.refundAmount || 0;
                }
            }
        }

        res.json({ rows, total: totalRefund });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/reports/inventory-adjustments
// @desc    Stock count gains/losses report
router.get('/inventory-adjustments', auth, requirePrivileged, async (req, res) => {
    try {
        const { from, to, storeId } = req.query;

        const dateFilter = buildDateFilter(from, to);

        const adjustments = await prisma.stockAdjustment.findMany({
            where: {
                tenantId: req.tenantId,
                ...(dateFilter && { date: dateFilter }),
                ...(storeId && { storeId })
            },
            orderBy: { date: 'desc' }
        });

        let totalGain = 0;
        let totalLoss = 0;

        for (const adj of adjustments) {
            const items = Array.isArray(adj.items) ? adj.items : [];
            for (const item of items) {
                const diff = item.difference || 0;
                if (diff > 0) totalGain += diff;
                else totalLoss += diff;
            }
        }

        res.json({ adjustments, totalGain, totalLoss, net: totalGain + totalLoss });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/reports/supplier-balances
// @desc    All suppliers with non-zero balances
router.get('/supplier-balances', auth, requirePrivileged, async (req, res) => {
    try {
        const suppliers = await prisma.supplier.findMany({
            where: {
                tenantId: req.tenantId,
                NOT: { balance: 0 }
            },
            select: { id: true, name: true, phone: true, balance: true },
            orderBy: { balance: 'desc' }
        });

        const totalOwed = suppliers.reduce((sum, s) => sum + s.balance, 0);

        res.json({ suppliers, totalOwed });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/reports/customer-balances
// @desc    All customers with non-zero balances
router.get('/customer-balances', auth, async (req, res) => {
    try {
        const customers = await prisma.customer.findMany({
            where: {
                tenantId: req.tenantId,
                NOT: { balance: 0 }
            },
            select: { id: true, name: true, phone: true, balance: true },
            orderBy: { balance: 'desc' }
        });

        const totalOwed = customers.reduce((sum, c) => sum + c.balance, 0);

        res.json({ customers, totalOwed });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/reports/purchases-report
// @desc    Purchases by supplier and period
router.get('/purchases-report', auth, requirePrivileged, async (req, res) => {
    try {
        const { from, to, supplierId } = req.query;

        const dateFilter = buildDateFilter(from, to);

        const purchases = await prisma.purchase.findMany({
            where: {
                tenantId: req.tenantId,
                ...(dateFilter && { date: dateFilter }),
                ...(supplierId && { supplierId })
            },
            include: {
                supplier: { select: { id: true, name: true, phone: true } }
            },
            orderBy: { date: 'desc' }
        });

        const totalAmount = purchases.reduce((sum, p) => sum + p.total, 0);

        // Build supplier breakdown
        const supplierMap = {};
        for (const p of purchases) {
            const sid = p.supplierId;
            if (!supplierMap[sid]) {
                supplierMap[sid] = {
                    supplierId: sid,
                    supplierName: p.supplier ? p.supplier.name : sid,
                    total: 0,
                    count: 0
                };
            }
            supplierMap[sid].total += p.total;
            supplierMap[sid].count += 1;
        }

        const supplierBreakdown = Object.values(supplierMap).sort((a, b) => b.total - a.total);

        res.json({ purchases, totalAmount, supplierBreakdown });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/reports/price-list
// @desc    All products with stock and pricing info
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

module.exports = router;
