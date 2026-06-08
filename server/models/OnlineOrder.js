const mongoose = require('../db');

const onlineOrderSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },

    // Source platform
    platform: { type: String, enum: ['amazon', 'jumia', 'woocommerce', 'noon'], required: true },
    platformOrderId: { type: String, required: true }, // External order ID
    platformOrderNumber: { type: String }, // Human-readable order number

    // Order status lifecycle
    status: {
        type: String,
        enum: ['pending', 'accepted', 'rejected', 'processing', 'shipped', 'completed', 'cancelled'],
        default: 'pending'
    },

    // Customer info from platform
    customerName: String,
    customerEmail: String,
    customerPhone: String,
    shippingAddress: {
        line1: String,
        line2: String,
        city: String,
        country: String
    },

    // Order items (normalized across platforms)
    items: [{
        platformItemId: String,
        sku: String,           // Matches product barcode in POS
        name: String,
        qty: { type: Number, default: 1 },
        price: { type: Number, default: 0 },
        productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' } // Linked POS product
    }],

    // Financials
    subtotal: { type: Number, default: 0 },
    shippingCost: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    currency: { type: String, default: 'EGP' },
    paymentMethod: String,
    paymentStatus: { type: String, default: 'pending' }, // pending, paid, cod

    // Notes
    notes: String,

    // When accepted into POS — links to the resulting Sale
    saleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale' },
    acceptedBy: String,
    acceptedAt: Date,
    rejectedReason: String,

    // Raw payload for debugging
    rawPayload: { type: mongoose.Schema.Types.Mixed },

    // Timestamps
    platformCreatedAt: Date,
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// Composite unique index to prevent duplicate imports
onlineOrderSchema.index({ tenantId: 1, platform: 1, platformOrderId: 1 }, { unique: true });
onlineOrderSchema.index({ tenantId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('OnlineOrder', onlineOrderSchema);
