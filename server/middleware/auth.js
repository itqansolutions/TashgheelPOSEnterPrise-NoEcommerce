const jwt = require('jsonwebtoken');
const prisma = require('../prisma');

module.exports = async function (req, res, next) {
    const token = req.header('x-auth-token');
    if (!token) return res.status(401).json({ msg: 'No token, authorization denied' });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret123');
        req.user = decoded.user;
        req.tenantId = decoded.user.tenantId;

        // Check subscription/trial status
        const tenant = await prisma.tenant.findUnique({ where: { id: req.tenantId } });
        if (!tenant) return res.status(401).json({ msg: 'Tenant not found' });

        const now = new Date();
        if (!tenant.isSubscribed && now > tenant.trialEndsAt) {
            // Allow admin to bypass trial block to fix settings/subscription
            if (req.user.role !== 'admin') {
                console.warn(`Trial expired for tenant ${tenant.id}. Trial ended ${tenant.trialEndsAt}`);
                return res.status(403).json({ msg: 'Trial expired. Please subscribe.', code: 'TRIAL_EXPIRED' });
            }
        }

        next();
    } catch (err) {
        res.status(401).json({ msg: 'Token is not valid' });
    }
};
