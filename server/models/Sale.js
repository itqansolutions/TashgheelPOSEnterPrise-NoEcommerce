const mongoose = require('../db');

const saleSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },
    receiptId: { type: String, required: true }, // e.g., receipt_123456
    shiftId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shift' },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
    date: { type: Date, default: Date.now },
    orderType: { type: String, enum: ['instore', 'online', 'delivery'], default: 'instore' },
    platform: { type: String, default: 'local' }, // local, woocommerce, jumia, amazon
    onlineOrderId: String, // Store the remote ID for traceability
    method: { type: String, enum: ['cash', 'card', 'mobile', 'split', 'credit'], required: true },
    splitPayments: [{
        method: { type: String, enum: ['cash', 'card', 'mobile'] },
        amount: Number
    }],
    cashier: { type: String, required: true },
    salesman: String,
    total: { type: Number, required: true },
    taxAmount: { type: Number, default: 0 },
    taxName: String,
    taxRate: Number,
    items: [{
        code: String,
        name: String,
        qty: Number,
        price: Number,
        discount: {
            type: { type: String, enum: ['none', 'percent', 'value'], default: 'none' },
            value: Number
        },
        cost: Number,
        returnedQty: { type: Number, default: 0 } // Track returned quantity per item
    }],
    status: { type: String, default: 'finished' }, // finished, returned, partial_returned
    returns: [{
        date: { type: Date, default: Date.now },
        items: [{
            code: String,
            qty: Number,
            refundAmount: Number,
            reason: String // Reason for this item return
        }],
        totalRefund: Number,
        cashier: String
    }],
    returnReason: String // For full cancellations
});

saleSchema.index({ tenantId: 1, date: -1 });

module.exports = mongoose.model('Sale', saleSchema);
