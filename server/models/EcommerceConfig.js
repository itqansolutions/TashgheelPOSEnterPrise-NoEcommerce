const mongoose = require('../db');

const ecommerceConfigSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    platform: { type: String, enum: ['amazon', 'jumia', 'woocommerce', 'noon'], required: true },

    enabled: { type: Boolean, default: false },

    // WooCommerce credentials
    woocommerce: {
        siteUrl: String,           // e.g. https://myshop.com
        consumerKey: String,       // ck_xxx
        consumerSecret: String,    // cs_xxx
        webhookSecret: String      // For verifying incoming webhooks
    },

    // Jumia Egypt credentials
    jumia: {
        apiKey: String,            // API key from Jumia Seller Center
        apiUrl: { type: String, default: 'https://sellercenter.jumia.com.eg' },
        userId: String
    },

    // Amazon SP-API credentials (Egypt / EU region)
    amazon: {
        sellerId: String,
        marketplaceId: { type: String, default: 'A1I7FNSA0GEFN2' }, // Amazon.eg marketplace ID
        clientId: String,          // LWA Client ID
        clientSecret: String,      // LWA Client Secret
        refreshToken: String,      // LWA Refresh Token
        region: { type: String, default: 'eu-west-1' }
    },

    // Noon Egypt credentials
    noon: {
        email: String,             // Noon partner account email
        password: String,          // Noon partner account password
        storeCode: String,         // Warehouse/Store code provided by Noon
        businessId: String,        // Noon Business ID (optional, from portal)
        apiUrl: { type: String, default: 'https://api.noon.partners/v2' }
    },

    // Sync settings
    syncSettings: {
        pushProducts: { type: Boolean, default: true },
        pullProducts: { type: Boolean, default: true },
        pullOrders: { type: Boolean, default: true },
        defaultStoreId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store' },
        autoAcceptOrders: { type: Boolean, default: false },
        syncIntervalMinutes: { type: Number, default: 15 }
    },

    // Status tracking
    lastSyncAt: Date,
    lastSyncStatus: { type: String, enum: ['success', 'error', 'never', 'syncing'], default: 'never' },
    lastSyncError: String,
    ordersImported: { type: Number, default: 0 },
    productsImported: { type: Number, default: 0 },
    productsPushed: { type: Number, default: 0 },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// One config per tenant per platform
ecommerceConfigSchema.index({ tenantId: 1, platform: 1 }, { unique: true });

module.exports = mongoose.model('EcommerceConfig', ecommerceConfigSchema);
