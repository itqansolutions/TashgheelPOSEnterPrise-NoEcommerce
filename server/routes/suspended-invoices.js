const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const prisma = require('../prisma');

// ================= SUSPENDED INVOICES =================

// @route   POST /api/suspended-invoices
// @desc    Create a suspended invoice
router.post('/', auth, async (req, res) => {
    try {
        const { storeId, cashier, customerId, items, discount, salesman, notes } = req.body;

        if (!storeId || !cashier || !items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ msg: 'storeId, cashier, and items are required' });
        }

        const record = await prisma.suspendedInvoice.create({
            data: {
                tenantId: req.tenantId,
                storeId,
                cashier,
                customerId: customerId || null,
                items,
                discount: discount || null,
                salesman: salesman || null,
                notes: notes || null,
                createdAt: new Date()
            }
        });

        res.json(record);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/suspended-invoices
// @desc    Get all suspended invoices (admins/managers see all; cashiers see own)
router.get('/', auth, async (req, res) => {
    try {
        const isPrivileged = req.user.role === 'admin' || req.user.role === 'manager';

        const where = {
            tenantId: req.tenantId,
            ...(!isPrivileged && { cashier: req.user.username })
        };

        const records = await prisma.suspendedInvoice.findMany({
            where,
            orderBy: { createdAt: 'desc' }
        });

        res.json(records);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/suspended-invoices/:id
// @desc    Get one suspended invoice (must belong to tenant)
router.get('/:id', auth, async (req, res) => {
    try {
        const record = await prisma.suspendedInvoice.findFirst({
            where: { id: req.params.id, tenantId: req.tenantId }
        });
        if (!record) return res.status(404).json({ msg: 'Suspended invoice not found' });

        res.json(record);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   DELETE /api/suspended-invoices/:id
// @desc    Delete a suspended invoice (must belong to tenant)
router.delete('/:id', auth, async (req, res) => {
    try {
        const record = await prisma.suspendedInvoice.findFirst({
            where: { id: req.params.id, tenantId: req.tenantId }
        });
        if (!record) return res.status(404).json({ msg: 'Suspended invoice not found' });

        await prisma.suspendedInvoice.delete({ where: { id: req.params.id } });
        res.json({ msg: 'Suspended invoice deleted' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;
