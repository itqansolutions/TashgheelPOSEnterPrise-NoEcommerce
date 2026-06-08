const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const prisma = require('../prisma');

// Hardcoded Super Admin Credentials (for V1)
const SUPER_ADMIN_USER = 'tashgheel';
const SUPER_ADMIN_PASS = 'BuFF@li2025#';

// Middleware to check super admin session
const checkSuperAdmin = (req, res, next) => {
    const secret = req.header('x-super-admin-secret');
    if (secret === 'super_secret_key_123') {
        next();
    } else {
        res.status(401).json({ msg: 'Unauthorized' });
    }
};

// @route   POST /api/super-admin/login
// @desc    Super Admin Login
router.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (username === SUPER_ADMIN_USER && password === SUPER_ADMIN_PASS) {
        res.json({ secret: 'super_secret_key_123' });
    } else {
        res.status(400).json({ msg: 'Invalid Credentials' });
    }
});

// @route   GET /api/super-admin/tenants
// @desc    Get all tenants
router.get('/tenants', checkSuperAdmin, async (req, res) => {
    try {
        const tenants = await prisma.tenant.findMany({
            orderBy: { createdAt: 'desc' }
        });
        res.json(tenants);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   PUT /api/super-admin/tenants/:id/status
// @desc    Update tenant status (active, on_hold, suspended)
router.put('/tenants/:id/status', checkSuperAdmin, async (req, res) => {
    try {
        const { status } = req.body;
        const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } });
        if (!tenant) return res.status(404).json({ msg: 'Tenant not found' });

        const updated = await prisma.tenant.update({
            where: { id: req.params.id },
            data: { status }
        });
        res.json(updated);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   PUT /api/super-admin/tenants/:id/subscription
// @desc    Extend/Renew subscription
router.put('/tenants/:id/subscription', checkSuperAdmin, async (req, res) => {
    try {
        const { months } = req.body;
        const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } });
        if (!tenant) return res.status(404).json({ msg: 'Tenant not found' });

        let currentEnd = tenant.subscriptionEndsAt || new Date();
        if (currentEnd < new Date()) currentEnd = new Date();

        const newEnd = new Date(currentEnd);
        newEnd.setMonth(newEnd.getMonth() + parseInt(months));

        const updated = await prisma.tenant.update({
            where: { id: req.params.id },
            data: {
                subscriptionEndsAt: newEnd,
                isSubscribed: true,
                status: 'active'
            }
        });
        res.json(updated);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   DELETE /api/super-admin/tenants/:id
// @desc    Terminate tenant (Delete all data via cascade)
router.delete('/tenants/:id', checkSuperAdmin, async (req, res) => {
    try {
        const tenantId = req.params.id;

        // All related records are deleted automatically via Cascade in Prisma schema
        await prisma.tenant.delete({ where: { id: tenantId } });

        res.json({ msg: 'Tenant terminated successfully' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   PUT /api/super-admin/tenants/:id/password
// @desc    Reset Tenant Admin Password
router.put('/tenants/:id/password', checkSuperAdmin, async (req, res) => {
    try {
        const { newPassword } = req.body;
        const tenantId = req.params.id;

        if (!newPassword || newPassword.length < 6) {
            return res.status(400).json({ msg: 'Password must be at least 6 characters' });
        }

        const user = await prisma.user.findFirst({
            where: { tenantId, role: 'admin' }
        });

        if (!user) {
            return res.status(404).json({ msg: 'Admin user not found for this tenant' });
        }

        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(newPassword, salt);

        await prisma.user.update({
            where: { id: user.id },
            data: { passwordHash }
        });

        res.json({ msg: 'Password reset successfully' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;
