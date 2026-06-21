const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../prisma');

// Super Admin Credentials from env vars or default fallback
const SUPER_ADMIN_USER = process.env.SUPER_ADMIN_USER || 'tashgheel';
const SUPER_ADMIN_PASS = process.env.SUPER_ADMIN_PASS || 'BuFF@li2025#';

// Middleware to check super admin session via JWT
const checkSuperAdmin = (req, res, next) => {
    const authHeader = req.header('Authorization');
    if (!authHeader) {
        return res.status(401).json({ msg: 'No token, authorization denied' });
    }

    const parts = authHeader.split(' ');
    if (parts[0] !== 'Bearer' || !parts[1]) {
        return res.status(401).json({ msg: 'Token format must be Bearer <token>' });
    }

    const token = parts[1];
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret123');
        if (!decoded.superAdmin) {
            return res.status(403).json({ msg: 'Access denied, not super admin' });
        }
        req.superAdmin = true;
        next();
    } catch (err) {
        res.status(401).json({ msg: 'Token is not valid' });
    }
};

// @route   POST /api/super-admin/login
// @desc    Super Admin Login
router.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (username === SUPER_ADMIN_USER && password === SUPER_ADMIN_PASS) {
        const token = jwt.sign({ superAdmin: true }, process.env.JWT_SECRET || 'secret123', { expiresIn: '1d' });
        res.json({ token });
    } else {
        res.status(400).json({ msg: 'Invalid Credentials' });
    }
});

// @route   GET /api/super-admin/tenants
// @desc    Get all tenants
router.get('/tenants', checkSuperAdmin, async (req, res) => {
    try {
        const tenants = await prisma.tenant.findMany({
            include: { plan: true },
            orderBy: { createdAt: 'desc' }
        });
        res.json(tenants);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/super-admin/tenants
// @desc    Create a new tenant (business) and admin user
router.post('/tenants', checkSuperAdmin, async (req, res) => {
    const { businessName, email, phone, username, password, trialDays, maxBranches, maxUsers, subscriptionPlanId } = req.body;

    try {
        const existingTenant = await prisma.tenant.findUnique({ where: { email } });
        if (existingTenant) {
            return res.status(400).json({ msg: 'Email already registered' });
        }

        const days = parseInt(trialDays) || 14;
        const trialEndsAt = new Date();
        trialEndsAt.setDate(trialEndsAt.getDate() + days);

        const tenant = await prisma.tenant.create({
            data: {
                businessName,
                email,
                phone,
                trialEndsAt,
                maxBranches: maxBranches !== undefined ? parseInt(maxBranches) : 3,
                maxUsers: maxUsers !== undefined ? parseInt(maxUsers) : 10,
                subscriptionPlanId: subscriptionPlanId || null,
                subscriptionPlan: subscriptionPlanId ? 'monthly' : 'free_trial'
            }
        });

        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);

        const user = await prisma.user.create({
            data: {
                tenantId: tenant.id,
                username,
                passwordHash,
                fullName: 'System Administrator',
                role: 'admin',
            }
        });

        const mainStore = await prisma.store.create({
            data: {
                tenantId: tenant.id,
                name: 'المخزن الرئيسي',
                location: 'Main',
                phone: phone || null
            }
        });

        await prisma.user.update({
            where: { id: user.id },
            data: { allowedStores: [mainStore.id] }
        });

        res.json(tenant);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/super-admin/tenants/:id/stats
// @desc    Get tenant stats (total sales, count, etc)
router.get('/tenants/:id/stats', checkSuperAdmin, async (req, res) => {
    try {
        const tenantId = req.params.id;
        
        const totalSales = await prisma.sale.count({ where: { tenantId } });
        
        const salesAggregate = await prisma.sale.aggregate({
            where: { tenantId },
            _sum: { total: true }
        });
        const totalSalesAmount = salesAggregate._sum.total || 0;

        const totalCustomers = await prisma.customer.count({ where: { tenantId } });
        const totalProducts = await prisma.product.count({ where: { tenantId } });

        const purchasesAggregate = await prisma.purchase.aggregate({
            where: { tenantId },
            _sum: { total: true }
        });
        const totalPurchases = purchasesAggregate._sum.total || 0;

        res.json({
            totalSales,
            totalSalesAmount,
            totalCustomers,
            totalProducts,
            totalPurchases
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   PUT /api/super-admin/tenants/:id/plan
// @desc    Update tenant subscription plan/limits
router.put('/tenants/:id/plan', checkSuperAdmin, async (req, res) => {
    try {
        const { subscriptionPlanId, maxBranches, maxUsers } = req.body;
        
        const dataUpdate = {};
        if (subscriptionPlanId !== undefined) {
            dataUpdate.subscriptionPlanId = subscriptionPlanId || null;
            if (subscriptionPlanId) {
                dataUpdate.subscriptionPlan = 'monthly'; // default
            } else {
                dataUpdate.subscriptionPlan = 'free_trial';
            }
        }
        if (maxBranches !== undefined) dataUpdate.maxBranches = parseInt(maxBranches);
        if (maxUsers !== undefined) dataUpdate.maxUsers = parseInt(maxUsers);

        const updated = await prisma.tenant.update({
            where: { id: req.params.id },
            data: dataUpdate
        });
        res.json(updated);
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
// @desc    Extend or Reduce subscription period (accepts positive or negative months)
router.put('/tenants/:id/subscription', checkSuperAdmin, async (req, res) => {
    try {
        const { months } = req.body;
        const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } });
        if (!tenant) return res.status(404).json({ msg: 'Tenant not found' });

        let currentEnd = tenant.subscriptionEndsAt || new Date();
        // If current end is in the past, default to today
        if (currentEnd < new Date() && parseInt(months) > 0) {
            currentEnd = new Date();
        }

        const newEnd = new Date(currentEnd);
        newEnd.setMonth(newEnd.getMonth() + parseInt(months));

        const updated = await prisma.tenant.update({
            where: { id: req.params.id },
            data: {
                subscriptionEndsAt: newEnd,
                isSubscribed: newEnd > new Date(),
                status: newEnd > new Date() ? 'active' : tenant.status
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
        await prisma.tenant.delete({ where: { id: req.params.id } });
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

// ================= PLANS CRUD =================

// @route   GET /api/super-admin/plans
// @desc    Get all subscription plans
router.get('/plans', checkSuperAdmin, async (req, res) => {
    try {
        const plans = await prisma.subscriptionPlan.findMany({
            orderBy: { createdAt: 'desc' }
        });
        res.json(plans);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/super-admin/plans
// @desc    Create a subscription plan
router.post('/plans', checkSuperAdmin, async (req, res) => {
    try {
        const { name, nameAr, maxBranches, maxUsers, storageGB, features, priceMonthly, priceYearly } = req.body;
        
        const plan = await prisma.subscriptionPlan.create({
            data: {
                name,
                nameAr: nameAr || null,
                maxBranches: parseInt(maxBranches) || 1,
                maxUsers: parseInt(maxUsers) || 5,
                storageGB: parseFloat(storageGB) || 1.0,
                features: features || [],
                priceMonthly: parseFloat(priceMonthly) || 0,
                priceYearly: parseFloat(priceYearly) || 0
            }
        });
        res.json(plan);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   PUT /api/super-admin/plans/:id
// @desc    Update a subscription plan
router.put('/plans/:id', checkSuperAdmin, async (req, res) => {
    try {
        const { name, nameAr, maxBranches, maxUsers, storageGB, features, priceMonthly, priceYearly } = req.body;
        
        const plan = await prisma.subscriptionPlan.update({
            where: { id: req.params.id },
            data: {
                name,
                nameAr: nameAr || null,
                maxBranches: parseInt(maxBranches),
                maxUsers: parseInt(maxUsers),
                storageGB: parseFloat(storageGB),
                features: features || [],
                priceMonthly: parseFloat(priceMonthly),
                priceYearly: parseFloat(priceYearly)
            }
        });
        res.json(plan);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   DELETE /api/super-admin/plans/:id
// @desc    Delete subscription plan (only if not used by any tenants)
router.delete('/plans/:id', checkSuperAdmin, async (req, res) => {
    try {
        const tenantCount = await prisma.tenant.count({
            where: { subscriptionPlanId: req.params.id }
        });
        if (tenantCount > 0) {
            return res.status(400).json({ msg: 'Cannot delete plan as it is currently assigned to tenants' });
        }

        await prisma.subscriptionPlan.delete({ where: { id: req.params.id } });
        res.json({ msg: 'Plan deleted successfully' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;
