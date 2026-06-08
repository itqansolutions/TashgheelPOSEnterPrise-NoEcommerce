/**
 * E-Commerce Integration Routes
 * Base path: /api/integrations
 *
 * Endpoints:
 *   GET    /api/integrations                        - List all platform configs for tenant
 *   GET    /api/integrations/:platform              - Get single platform config (no secrets)
 *   POST   /api/integrations/:platform/connect      - Save credentials & test connection
 *   DELETE /api/integrations/:platform              - Disconnect platform
 *   POST   /api/integrations/:platform/sync         - Manual sync (pull orders + push products)
 *   GET    /api/integrations/orders/pending         - Get all pending online orders
 *   GET    /api/integrations/orders/:id             - Get single online order
 *   POST   /api/integrations/orders/:id/accept      - Accept pending order → creates Sale
 *   POST   /api/integrations/orders/:id/reject      - Reject pending order
 *   POST   /api/integrations/woocommerce/webhook    - WooCommerce webhook receiver
 */

const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const prisma = require('../prisma');
const WooCommerceConnector = require('../integrations/woocommerce');
const JumiaConnector = require('../integrations/jumia');
const AmazonConnector = require('../integrations/amazon');
const NoonConnector = require('../integrations/noon');

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function getConnector(platform, config) {
    switch (platform) {
        case 'woocommerce': return new WooCommerceConnector(config.woocommerce || {});
        case 'jumia': return new JumiaConnector(config.jumia || {});
        case 'amazon': return new AmazonConnector(config.amazon || {});
        case 'noon': return new NoonConnector(config.noon || {});
        default: throw new Error(`Unknown platform: ${platform}`);
    }
}

/** Strip sensitive fields from config before sending to frontend */
function sanitizeConfig(config) {
    const obj = { ...config };
    if (obj.woocommerce) {
        const wc = { ...(obj.woocommerce || {}) };
        delete wc.consumerKey;
        delete wc.consumerSecret;
        delete wc.webhookSecret;
        obj.woocommerce = wc;
    }
    if (obj.jumia) {
        const j = { ...(obj.jumia || {}) };
        delete j.apiKey;
        obj.jumia = j;
    }
    if (obj.amazon) {
        const a = { ...(obj.amazon || {}) };
        delete a.clientSecret;
        delete a.refreshToken;
        obj.amazon = a;
    }
    if (obj.noon) {
        const n = { ...(obj.noon || {}) };
        delete n.password;
        obj.noon = n;
    }
    return obj;
}

/** Try to match platform items to POS products by SKU/barcode */
async function linkItemsToProducts(tenantId, items) {
    const linked = [];
    for (const item of items) {
        let product = null;
        if (item.sku) {
            product = await prisma.product.findFirst({ where: { tenantId, barcode: item.sku } });
        }
        if (!product && item.name) {
            product = await prisma.product.findFirst({
                where: { tenantId, name: { equals: item.name, mode: 'insensitive' } }
            });
        }
        linked.push({ ...item, productId: product?.id || null });
    }
    return linked;
}

// ─────────────────────────────────────────────
// PLATFORM CONFIG ROUTES
// ─────────────────────────────────────────────

/**
 * GET /api/integrations
 * List all platform configs (without secrets)
 */
router.get('/', auth, async (req, res) => {
    try {
        let configs = await prisma.ecommerceConfig.findMany({
            where: { tenantId: req.tenantId }
        });

        // Bootstrap missing platforms
        const platforms = ['woocommerce', 'jumia', 'amazon', 'noon'];
        const existingPlatforms = configs.map(c => c.platform);
        const missing = platforms.filter(p => !existingPlatforms.includes(p));

        if (missing.length > 0) {
            await prisma.ecommerceConfig.createMany({
                data: missing.map(p => ({ tenantId: req.tenantId, platform: p }))
            });
            configs = await prisma.ecommerceConfig.findMany({
                where: { tenantId: req.tenantId }
            });
        }

        res.json(configs.map(sanitizeConfig));
    } catch (err) {
        console.error('[integrations] GET /', err.message);
        res.status(500).json({ msg: 'Server Error' });
    }
});

/**
 * GET /api/integrations/:platform
 */
router.get('/:platform', auth, async (req, res) => {
    try {
        const { platform } = req.params;
        const config = await prisma.ecommerceConfig.findFirst({
            where: { tenantId: req.tenantId, platform }
        });
        if (!config) return res.json({ platform, enabled: false });
        res.json(sanitizeConfig(config));
    } catch (err) {
        console.error('[integrations] GET /:platform', err.message);
        res.status(500).json({ msg: 'Server Error' });
    }
});

/**
 * POST /api/integrations/:platform/connect
 */
router.post('/:platform/connect', auth, async (req, res) => {
    try {
        const { platform } = req.params;
        const { syncSettings, ...credentials } = req.body;

        let config = await prisma.ecommerceConfig.findFirst({
            where: { tenantId: req.tenantId, platform }
        });

        // Build updated credential object
        let credentialData = {};

        if (platform === 'woocommerce') {
            const existing = (config && config.woocommerce) ? config.woocommerce : {};
            credentialData.woocommerce = {
                ...existing,
                siteUrl: credentials.siteUrl || existing.siteUrl,
                webhookSecret: credentials.webhookSecret || existing.webhookSecret,
                ...(credentials.consumerKey && credentials.consumerKey !== '********' && { consumerKey: credentials.consumerKey }),
                ...(credentials.consumerSecret && credentials.consumerSecret !== '********' && { consumerSecret: credentials.consumerSecret })
            };
        } else if (platform === 'jumia') {
            credentialData.jumia = {
                apiKey: credentials.apiKey,
                userId: credentials.userId,
                apiUrl: credentials.apiUrl || 'https://sellercenter.jumia.com.eg'
            };
        } else if (platform === 'amazon') {
            credentialData.amazon = {
                sellerId: credentials.sellerId,
                marketplaceId: credentials.marketplaceId || 'A1I7FNSA0GEFN2',
                clientId: credentials.clientId,
                clientSecret: credentials.clientSecret,
                refreshToken: credentials.refreshToken,
                region: credentials.region || 'eu-west-1'
            };
        } else if (platform === 'noon') {
            const existing = (config && config.noon) ? config.noon : {};
            credentialData.noon = {
                ...existing,
                ...(credentials.email && { email: credentials.email }),
                ...(credentials.password && credentials.password !== '********' && { password: credentials.password }),
                ...(credentials.storeCode && { storeCode: credentials.storeCode }),
                ...(credentials.businessId && { businessId: credentials.businessId }),
                apiUrl: credentials.apiUrl || 'https://api.noon.partners/v2'
            };
        } else {
            return res.status(400).json({ msg: 'Invalid platform' });
        }

        if (syncSettings && config) {
            credentialData.syncSettings = { ...(config.syncSettings || {}), ...syncSettings };
        } else if (syncSettings) {
            credentialData.syncSettings = syncSettings;
        }

        // Test connection (use merged config)
        const mergedConfig = { ...(config || {}), ...credentialData };
        const connector = getConnector(platform, mergedConfig);
        const testResult = await connector.testConnection();

        // Upsert config
        if (config) {
            config = await prisma.ecommerceConfig.update({
                where: { id: config.id },
                data: { ...credentialData, enabled: true, lastSyncStatus: 'success', updatedAt: new Date() }
            });
        } else {
            config = await prisma.ecommerceConfig.create({
                data: {
                    tenantId: req.tenantId,
                    platform,
                    enabled: true,
                    lastSyncStatus: 'success',
                    ...credentialData
                }
            });
        }

        res.json({ msg: 'Connected successfully', testResult, config: sanitizeConfig(config) });
    } catch (err) {
        console.error(`[integrations] POST /${req.params.platform}/connect`, err.message);
        res.status(400).json({ msg: `Connection failed: ${err.message}` });
    }
});

/**
 * DELETE /api/integrations/:platform
 */
router.delete('/:platform', auth, async (req, res) => {
    try {
        await prisma.ecommerceConfig.deleteMany({
            where: { tenantId: req.tenantId, platform: req.params.platform }
        });
        res.json({ msg: `${req.params.platform} disconnected` });
    } catch (err) {
        console.error('[integrations] DELETE /:platform', err.message);
        res.status(500).json({ msg: 'Server Error' });
    }
});

// ─────────────────────────────────────────────
// SYNC ROUTES
// ─────────────────────────────────────────────

/**
 * POST /api/integrations/:platform/sync
 */
router.post('/:platform/sync', auth, async (req, res) => {
    const { platform } = req.params;
    try {
        const config = await prisma.ecommerceConfig.findFirst({
            where: { tenantId: req.tenantId, platform }
        });
        if (!config || !config.enabled) {
            return res.status(400).json({ msg: `${platform} is not connected` });
        }

        const connector = getConnector(platform, config);

        await prisma.ecommerceConfig.update({
            where: { id: config.id },
            data: { lastSyncStatus: 'syncing' }
        });

        // Start background sync (non-blocking)
        syncBackgroundTask(req.tenantId, platform, config, connector);

        res.json({ msg: 'Synchronization started in background.' });
    } catch (err) {
        console.error(`[integrations] POST /${platform}/sync`, err.message);
        res.status(500).json({ msg: `Sync error: ${err.message}` });
    }
});

/**
 * Background Sync Implementation
 */
async function syncBackgroundTask(tenantId, platform, config, connector) {
    const results = { ordersImported: 0, productsImported: 0, productsPushed: 0, errors: [] };

    const updateProgress = async (status, error = null) => {
        try {
            await prisma.ecommerceConfig.update({
                where: { id: config.id },
                data: {
                    lastSyncStatus: status,
                    lastSyncError: error || results.errors[0] || '',
                    updatedAt: new Date()
                }
            });
        } catch (e) { console.error('Progress update failed', e); }
    };

    try {
        await updateProgress('syncing', 'Starting background task...');
        console.log(`[sync] Starting background sync for tenant ${tenantId} on ${platform}`);

        // === PULL ORDERS ===
        const syncSettings = config.syncSettings || {};
        if (syncSettings.pullOrders !== false) {
            await updateProgress('syncing', 'Pulling orders...');
            try {
                let rawOrders = [];
                const after = config.lastSyncAt || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

                if (platform === 'woocommerce') rawOrders = await connector.getOrders(after);
                else if (platform === 'jumia') {
                    const response = await connector.getOrders('pending', config.lastSyncAt);
                    rawOrders = response?.SuccessResponse?.Body?.Orders?.Order || [];
                    if (!Array.isArray(rawOrders)) rawOrders = rawOrders ? [rawOrders] : [];
                } else if (platform === 'amazon') rawOrders = await connector.getOrders(config.lastSyncAt);
                else if (platform === 'noon') {
                    rawOrders = await connector.getOrders(config.lastSyncAt);
                    if (!Array.isArray(rawOrders)) rawOrders = rawOrders ? [rawOrders] : [];
                }

                for (const rawOrder of rawOrders) {
                    try {
                        let normalized, items = [];

                        if (platform === 'woocommerce') normalized = WooCommerceConnector.normalizeOrder(rawOrder);
                        else if (platform === 'jumia') {
                            try {
                                const itemsResp = await connector.getOrderItems(rawOrder.OrderId);
                                items = itemsResp?.SuccessResponse?.Body?.OrderItems?.OrderItem || [];
                                if (!Array.isArray(items)) items = items ? [items] : [];
                            } catch (e) {}
                            normalized = JumiaConnector.normalizeOrder(rawOrder, items);
                        } else if (platform === 'amazon') {
                            try { items = await connector.getOrderItems(rawOrder.AmazonOrderId); } catch (e) {}
                            normalized = AmazonConnector.normalizeOrder(rawOrder, items);
                        } else if (platform === 'noon') {
                            try {
                                const noonId = rawOrder.orderNumber || rawOrder.id;
                                items = await connector.getOrderItems(noonId);
                            } catch (e) {}
                            normalized = NoonConnector.normalizeOrder(rawOrder, items);
                        }

                        normalized.items = await linkItemsToProducts(tenantId, normalized.items);

                        const existing = await prisma.onlineOrder.findFirst({
                            where: { tenantId, platform, platformOrderId: normalized.platformOrderId }
                        });

                        if (!existing) {
                            await prisma.onlineOrder.create({ data: { tenantId, ...normalized } });
                            results.ordersImported++;
                        }
                    } catch (e) {
                        results.errors.push(`Order import error: ${e.message}`);
                    }
                }
            } catch (e) {
                results.errors.push(`Pull orders error: ${e.message}`);
            }
        }

        // === PULL PRODUCTS (WooCommerce to POS) ===
        if (syncSettings.pullProducts !== false && platform === 'woocommerce') {
            await updateProgress('syncing', 'Fetching products from WooCommerce...');
            try {
                let page = 1, hasMore = true;
                while (hasMore) {
                    const wcProducts = await connector.getProducts(page);
                    if (!wcProducts || wcProducts.length === 0) { hasMore = false; break; }

                    await prisma.auditLog.create({
                        data: {
                            tenantId,
                            user: 'System (Sync)',
                            action: 'WooCommerce Data Received',
                            details: `Page ${page}: Received ${wcProducts.length} products`,
                            timestamp: new Date()
                        }
                    });

                    for (const wcP of wcProducts) {
                        try {
                            const sku = String(wcP.sku || wcP.id);
                            const existingProduct = await prisma.product.findFirst({ where: { tenantId, barcode: sku } });
                            const sellingPrice = wcP.on_sale && wcP.sale_price ? parseFloat(wcP.sale_price) : (parseFloat(wcP.regular_price) || 0);
                            const regPrice = parseFloat(wcP.regular_price) || 0;
                            const imageUrl = wcP.images?.[0]?.src || '';
                            const stockCount = parseInt(wcP.stock_quantity) || 0;

                            if (existingProduct) {
                                await prisma.product.update({
                                    where: { id: existingProduct.id },
                                    data: { price: sellingPrice, priceOnline: regPrice, imageUrl: imageUrl || existingProduct.imageUrl, stock: stockCount, active: true }
                                });
                            } else {
                                const catName = wcP.categories?.[0]?.name || 'Uncategorized';
                                let category = await prisma.category.findFirst({ where: { tenantId, name: catName } });
                                if (!category) category = await prisma.category.create({ data: { tenantId, name: catName } });

                                await prisma.product.create({
                                    data: { tenantId, name: wcP.name, nameEn: wcP.name, barcode: sku, price: sellingPrice, priceOnline: regPrice, stock: stockCount, category: catName, categoryEn: catName, imageUrl, active: true, trackStock: wcP.manage_stock, onlineActive: true }
                                });
                            }
                            results.productsImported++;
                        } catch (e) {
                            results.errors.push(`Product pull error for "${wcP.name}": ${e.message}`);
                        }
                    }
                    page++;
                    if (page > 20) hasMore = false;
                }
            } catch (e) {
                results.errors.push(`Pull products error: ${e.message}`);
            }
        }

        // === PUSH PRODUCTS (POS to WooCommerce) ===
        if (syncSettings.pushProducts !== false && platform === 'woocommerce') {
            await updateProgress('syncing', 'Pushing products to WooCommerce...');
            try {
                const products = await prisma.product.findMany({ where: { tenantId, active: true } });
                for (const product of products.slice(0, 50)) {
                    try {
                        await connector.pushProduct(product);
                        results.productsPushed++;
                    } catch (e) {
                        results.errors.push(`Push product "${product.name}": ${e.message}`);
                    }
                }
            } catch (e) {
                results.errors.push(`Push products error: ${e.message}`);
            }
        }

        // Update config stats
        await prisma.ecommerceConfig.update({
            where: { id: config.id },
            data: {
                lastSyncAt: new Date(),
                lastSyncStatus: results.errors.length === 0 ? 'success' : 'error',
                lastSyncError: results.errors.length ? results.errors[0] : null,
                ordersImported: { increment: results.ordersImported },
                productsImported: { increment: results.productsImported },
                productsPushed: { increment: results.productsPushed },
                updatedAt: new Date()
            }
        });
        console.log(`[sync] Background sync finished for tenant ${tenantId}`);
    } catch (err) {
        console.error(`[sync] Background sync fatal error:`, err.message);
        try {
            await prisma.ecommerceConfig.update({
                where: { id: config.id },
                data: { lastSyncStatus: 'error', lastSyncError: `Fatal: ${err.message}` }
            });
        } catch (e) {}
    }
}

// ─────────────────────────────────────────────
// PENDING ORDERS ROUTES
// ─────────────────────────────────────────────

router.get('/orders/pending', auth, async (req, res) => {
    try {
        const orders = await prisma.onlineOrder.findMany({
            where: { tenantId: req.tenantId, status: 'pending' },
            orderBy: { createdAt: 'desc' },
            take: 100
        });
        res.json(orders);
    } catch (err) {
        console.error('[integrations] GET /orders/pending', err.message);
        res.status(500).json({ msg: 'Server Error' });
    }
});

router.get('/orders', auth, async (req, res) => {
    try {
        const { status, platform, limit = 50 } = req.query;
        const where = { tenantId: req.tenantId };
        if (status) where.status = status;
        if (platform) where.platform = platform;

        const orders = await prisma.onlineOrder.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: parseInt(limit)
        });
        res.json(orders);
    } catch (err) {
        console.error('[integrations] GET /orders', err.message);
        res.status(500).json({ msg: 'Server Error' });
    }
});

router.get('/orders/:id', auth, async (req, res) => {
    try {
        const order = await prisma.onlineOrder.findFirst({
            where: { id: req.params.id, tenantId: req.tenantId }
        });
        if (!order) return res.status(404).json({ msg: 'Order not found' });
        res.json(order);
    } catch (err) {
        res.status(500).json({ msg: 'Server Error' });
    }
});

/**
 * POST /api/integrations/orders/:id/accept
 */
router.post('/orders/:id/accept', auth, async (req, res) => {
    try {
        const order = await prisma.onlineOrder.findFirst({
            where: { id: req.params.id, tenantId: req.tenantId, status: 'pending' }
        });
        if (!order) return res.status(404).json({ msg: 'Pending order not found' });

        const paymentMethod = req.body.paymentMethod || 'cash';

        const shift = await prisma.shift.findFirst({
            where: { tenantId: req.tenantId, cashier: req.user.username, status: 'open' }
        });
        if (!shift) {
            return res.status(400).json({ msg: 'No open shift. Please open a shift before accepting orders.' });
        }

        const orderItems = Array.isArray(order.items) ? order.items : [];
        const saleItems = [];

        for (const item of orderItems) {
            saleItems.push({
                code: item.sku || (item.productId || ''),
                name: item.name,
                qty: item.qty,
                price: item.price,
                productId: item.productId,
                discount: { type: 'none', value: 0 }
            });

            // Deduct stock
            if (item.productId) {
                const product = await prisma.product.findFirst({
                    where: { id: item.productId, tenantId: req.tenantId }
                });
                if (product && product.trackStock !== false) {
                    const stores = Array.isArray(product.stores) ? product.stores : [];
                    const storeIdx = stores.findIndex(s => s.storeId === shift.storeId);
                    if (storeIdx >= 0) {
                        stores[storeIdx].stock = Math.max(0, (stores[storeIdx].stock || 0) - item.qty);
                    } else {
                        stores.push({ storeId: shift.storeId, stock: -item.qty });
                    }
                    await prisma.product.update({
                        where: { id: product.id },
                        data: { stock: Math.max(0, product.stock - item.qty), stores }
                    });
                }
            }
        }

        const shiftCount = await prisma.sale.count({ where: { shiftId: shift.id } });
        const receiptId = `${order.platform.toUpperCase().slice(0, 2)}-${shiftCount + 1}`;

        const sale = await prisma.sale.create({
            data: {
                tenantId: req.tenantId,
                storeId: shift.storeId,
                receiptId,
                shiftId: shift.id,
                date: new Date(),
                method: paymentMethod,
                orderType: 'online',
                cashier: req.user.username,
                total: order.total,
                items: saleItems,
                splitPayments: []
            }
        });

        const updatedOrder = await prisma.onlineOrder.update({
            where: { id: order.id },
            data: {
                status: 'accepted',
                saleId: sale.id,
                acceptedBy: req.user.username,
                acceptedAt: new Date(),
                updatedAt: new Date()
            }
        });

        // Try to update status on the platform
        try {
            const config = await prisma.ecommerceConfig.findFirst({
                where: { tenantId: req.tenantId, platform: order.platform }
            });
            if (config?.enabled) {
                const connector = getConnector(order.platform, config);
                if (order.platform === 'woocommerce') {
                    await connector.updateOrderStatus(order.platformOrderId, 'processing');
                } else if (order.platform === 'jumia') {
                    const itemIds = orderItems.map(i => i.platformItemId).filter(Boolean);
                    if (itemIds.length) await connector.confirmOrder(itemIds);
                } else if (order.platform === 'noon') {
                    await connector.confirmOrder(order.platformOrderId);
                }
            }
        } catch (platformErr) {
            console.warn('[integrations] Platform status update failed (non-critical):', platformErr.message);
        }

        res.json({ msg: 'Order accepted and added to POS', sale, order: updatedOrder });
    } catch (err) {
        console.error('[integrations] POST /orders/:id/accept', err.message);
        res.status(500).json({ msg: `Error accepting order: ${err.message}` });
    }
});

/**
 * POST /api/integrations/orders/:id/reject
 */
router.post('/orders/:id/reject', auth, async (req, res) => {
    try {
        const order = await prisma.onlineOrder.findFirst({
            where: { id: req.params.id, tenantId: req.tenantId, status: 'pending' }
        });
        if (!order) return res.status(404).json({ msg: 'Pending order not found' });

        const updatedOrder = await prisma.onlineOrder.update({
            where: { id: order.id },
            data: {
                status: 'rejected',
                rejectedReason: req.body.reason || 'Rejected by cashier',
                updatedAt: new Date()
            }
        });

        // Try to cancel on platform
        try {
            const config = await prisma.ecommerceConfig.findFirst({
                where: { tenantId: req.tenantId, platform: order.platform }
            });
            if (config?.enabled && order.platform === 'woocommerce') {
                const connector = getConnector(order.platform, config);
                await connector.updateOrderStatus(order.platformOrderId, 'cancelled');
            }
        } catch (platformErr) {
            console.warn('[integrations] Platform cancel failed (non-critical):', platformErr.message);
        }

        res.json({ msg: 'Order rejected', order: updatedOrder });
    } catch (err) {
        console.error('[integrations] POST /orders/:id/reject', err.message);
        res.status(500).json({ msg: 'Server Error' });
    }
});

// ─────────────────────────────────────────────
// WOOCOMMERCE WEBHOOK
// ─────────────────────────────────────────────

router.post('/woocommerce/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    try {
        const rawBody = req.body;
        const signature = req.headers['x-wc-webhook-signature'];
        const topic = req.headers['x-wc-webhook-topic'];
        const tenantId = req.query.tenantId;

        if (!tenantId) {
            return res.status(400).json({ msg: 'tenantId query param required' });
        }

        const config = await prisma.ecommerceConfig.findFirst({
            where: { platform: 'woocommerce', tenantId }
        });
        if (!config) return res.status(404).json({ msg: 'Config not found' });

        if (config.woocommerce?.webhookSecret && signature) {
            const crypto = require('crypto');
            const expectedSig = crypto
                .createHmac('sha256', config.woocommerce.webhookSecret)
                .update(rawBody)
                .digest('base64');
            if (expectedSig !== signature) {
                return res.status(401).json({ msg: 'Invalid webhook signature' });
            }
        }

        if (topic === 'order.created' || topic === 'order.updated') {
            const wcOrder = JSON.parse(rawBody.toString());

            if (wcOrder.status === 'processing' || wcOrder.status === 'pending') {
                const normalized = WooCommerceConnector.normalizeOrder(wcOrder);
                normalized.items = await linkItemsToProducts(tenantId, normalized.items);

                await prisma.onlineOrder.upsert({
                    where: {
                        tenantId_platform_platformOrderId: {
                            tenantId,
                            platform: 'woocommerce',
                            platformOrderId: normalized.platformOrderId
                        }
                    },
                    create: { tenantId, ...normalized },
                    update: {} // Don't overwrite existing
                });
            }
        }

        res.status(200).json({ received: true });
    } catch (err) {
        console.error('[integrations] WC webhook error:', err.message);
        res.status(500).json({ msg: 'Webhook processing error' });
    }
});

module.exports = router;
module.exports.syncBackgroundTask = syncBackgroundTask;
