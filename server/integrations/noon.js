/**
 * Noon Egypt (noon.partners) Seller API Connector
 * 
 * Authentication: JWT-based via email/password login
 * API Base: https://api.noon.partners/v2
 * 
 * Noon Egypt provides a private seller API for FBPI (Fulfilled by Partner Integration).
 * The API uses JWT tokens obtained by POSTing credentials to the auth endpoint.
 * 
 * Key capabilities:
 *   - Get pending/unconfirmed orders
 *   - Get order details and items
 *   - Confirm/acknowledge orders
 *   - Update inventory/stock levels
 *   - Retrieve shipping labels
 * 
 * Credentials required (from noon.partners portal):
 *   - email: Seller account email
 *   - password: Seller account password
 *   - storeCode: Warehouse code provided by Noon
 */

const https = require('https');

const NOON_API_BASE = 'api.noon.partners';

class NoonConnector {
    constructor(config) {
        this.email = config.email;
        this.password = config.password;
        this.storeCode = config.storeCode;
        this.businessId = config.businessId;
        this.apiBase = NOON_API_BASE;
        this._token = null;
        this._tokenExpiry = null;
    }

    /**
     * Authenticate and obtain JWT token
     */
    async _getToken() {
        // Return cached token if still valid (expires after ~24h, refresh 30min before)
        if (this._token && this._tokenExpiry && Date.now() < this._tokenExpiry) {
            return this._token;
        }

        if (!this.email || !this.password) {
            throw new Error('Noon credentials not configured. Please set email and password.');
        }

        const body = JSON.stringify({
            email: this.email,
            password: this.password,
            userType: 'seller'
        });

        return new Promise((resolve, reject) => {
            const req = https.request({
                hostname: this.apiBase,
                path: '/v2/auth/token',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body),
                    'Accept': 'application/json',
                    'User-Agent': 'TashgheelPOS/3.0'
                }
            }, (res) => {
                let data = '';
                res.on('data', c => data += c);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        if (parsed.token || parsed.access_token || (parsed.data && parsed.data.token)) {
                            const token = parsed.token || parsed.access_token || parsed.data.token;
                            this._token = token;
                            // Cache for 23 hours
                            this._tokenExpiry = Date.now() + (23 * 60 * 60 * 1000);
                            resolve(token);
                        } else {
                            reject(new Error(`Noon auth failed: ${parsed.message || parsed.error || JSON.stringify(parsed)}`));
                        }
                    } catch (e) {
                        reject(new Error(`Failed to parse Noon auth response: ${data.substring(0, 300)}`));
                    }
                });
            });
            req.on('error', reject);
            req.write(body);
            req.end();
        });
    }

    /**
     * Make an authenticated Noon API request
     */
    async _request(method, path, body = null, extraHeaders = {}) {
        const token = await this._getToken();

        const reqOptions = {
            hostname: this.apiBase,
            path: path,
            method,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'User-Agent': 'TashgheelPOS/3.0',
                ...extraHeaders
            }
        };

        const bodyStr = body ? JSON.stringify(body) : null;
        if (bodyStr) reqOptions.headers['Content-Length'] = Buffer.byteLength(bodyStr);

        return new Promise((resolve, reject) => {
            const req = https.request(reqOptions, (res) => {
                let data = '';
                res.on('data', c => data += c);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        if (res.statusCode >= 200 && res.statusCode < 300) {
                            resolve(parsed);
                        } else {
                            const errMsg = parsed.message || parsed.error || data.substring(0, 300);
                            reject(new Error(`Noon API ${res.statusCode}: ${errMsg}`));
                        }
                    } catch (e) {
                        if (res.statusCode >= 200 && res.statusCode < 300) {
                            resolve({ raw: data });
                        } else {
                            reject(new Error(`Noon API ${res.statusCode}: ${data.substring(0, 300)}`));
                        }
                    }
                });
            });
            req.on('error', reject);
            if (bodyStr) req.write(bodyStr);
            req.end();
        });
    }

    /**
     * Test the connection by authenticating
     */
    async testConnection() {
        await this._getToken();
        return { success: true, message: 'Connected to Noon Egypt Seller API' };
    }

    /**
     * Get orders from Noon
     * Status values: 'CREATED', 'CONFIRMED', 'PACKED', 'READY_TO_SHIP', 'DISPATCHED', 'DELIVERED'
     */
    async getOrders(createdAfter = null) {
        let path = `/v2/fulfillment-inbound/orders?status=CREATED&pageSize=50`;
        if (this.storeCode) {
            path += `&warehouseCode=${encodeURIComponent(this.storeCode)}`;
        }
        if (createdAfter) {
            const afterTs = Math.floor(new Date(createdAfter).getTime() / 1000);
            path += `&fromDate=${afterTs}`;
        }

        try {
            const result = await this._request('GET', path);
            // Handle various response shapes
            return result?.orders || result?.data?.orders || result?.items || result?.data || [];
        } catch (e) {
            // Try alternate endpoint
            try {
                const alt = await this._request('GET', `/v2/marketplace/orders?status=pending&pageSize=50`);
                return alt?.orders || alt?.data?.orders || alt?.data || [];
            } catch {
                throw e;
            }
        }
    }

    /**
     * Get order details by order ID/number
     */
    async getOrderDetails(orderNumber) {
        const result = await this._request('GET', `/v2/fulfillment-inbound/orders/${orderNumber}`);
        return result?.order || result?.data?.order || result?.data || result;
    }

    /**
     * Get order items for a given order
     */
    async getOrderItems(orderNumber) {
        try {
            const result = await this._request('GET', `/v2/fulfillment-inbound/orders/${orderNumber}/items`);
            return result?.items || result?.data?.items || result?.data || [];
        } catch {
            return [];
        }
    }

    /**
     * Confirm/acknowledge a Noon order (moves from CREATED → CONFIRMED)
     */
    async confirmOrder(orderNumber) {
        return this._request('PUT', `/v2/fulfillment-inbound/orders/${orderNumber}/confirm`, {});
    }

    /**
     * Cancel an order
     */
    async cancelOrder(orderNumber, reason = 'Seller cancelled') {
        return this._request('PUT', `/v2/fulfillment-inbound/orders/${orderNumber}/cancel`, {
            cancelReason: reason
        });
    }

    /**
     * Update stock/inventory for a SKU on Noon
     */
    async updateInventory(sku, quantity) {
        if (!this.storeCode) return { status: 'skipped', reason: 'No warehouse/store code configured' };
        return this._request('POST', `/v2/fulfillment-inbound/inventory`, {
            warehouseCode: this.storeCode,
            items: [{ sku, quantity }]
        });
    }

    /**
     * Push a POS product to Noon inventory
     */
    async pushProduct(product) {
        const sku = product.barcode || String(product._id);
        const qty = product.stock || 0;
        return this.updateInventory(sku, qty);
    }

    /**
     * Normalize a Noon order to our standard OnlineOrder format
     */
    static normalizeOrder(noonOrder, noonItems = []) {
        // Noon may use different field naming conventions
        const addr = noonOrder.shippingAddress || noonOrder.ShippingAddress || noonOrder.delivery_address || {};
        const customerName = noonOrder.customerName || noonOrder.CustomerName ||
            [noonOrder.firstName, noonOrder.lastName].filter(Boolean).join(' ').trim() ||
            addr.name || addr.Name || 'Noon Customer';

        const items = (noonItems.length > 0 ? noonItems : (noonOrder.items || noonOrder.Items || [])).map(item => ({
            platformItemId: String(item.id || item.itemId || item.lineItemId || ''),
            sku: item.sku || item.sellerSku || item.SellerSku || '',
            name: item.name || item.title || item.productName || '',
            qty: parseInt(item.quantity || item.qty || item.orderedQuantity || 1),
            price: parseFloat(item.salePrice || item.price || item.unitPrice || item.itemPrice || 0)
        }));

        const total = parseFloat(
            noonOrder.grandTotal || noonOrder.totalAmount || noonOrder.total ||
            items.reduce((s, i) => s + (i.qty * i.price), 0)
        );

        return {
            platform: 'noon',
            platformOrderId: String(noonOrder.orderNumber || noonOrder.id || noonOrder.orderId || ''),
            platformOrderNumber: String(noonOrder.orderNumber || noonOrder.displayId || noonOrder.id || ''),
            customerName,
            customerEmail: noonOrder.customerEmail || noonOrder.email || addr.email || '',
            customerPhone: noonOrder.customerPhone || noonOrder.phone || addr.phone || addr.mobile || '',
            shippingAddress: {
                line1: addr.addressLine1 || addr.line1 || addr.address || '',
                line2: addr.addressLine2 || addr.line2 || '',
                city: addr.city || addr.City || '',
                country: addr.country || 'EG'
            },
            items,
            subtotal: parseFloat(noonOrder.subtotal || noonOrder.subTotal || total),
            shippingCost: parseFloat(noonOrder.shippingFee || noonOrder.deliveryCharge || 0),
            discount: parseFloat(noonOrder.discount || noonOrder.promoDiscount || 0),
            total,
            currency: noonOrder.currency || 'EGP',
            paymentMethod: noonOrder.paymentMethod || noonOrder.PaymentMethod || 'cod',
            paymentStatus: (noonOrder.paymentStatus || '').toLowerCase().includes('paid') ? 'paid' : 'cod',
            notes: noonOrder.buyerNote || noonOrder.notes || '',
            platformCreatedAt: new Date(noonOrder.createdAt || noonOrder.orderDate || Date.now())
        };
    }
}

module.exports = NoonConnector;
