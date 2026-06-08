const mongoose = require('../db');

const purchaseSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },
    supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
    receiptId: { type: String, required: true },
    date: { type: Date, default: Date.now },
    total: { type: Number, required: true },
    cashPaid: { type: Number, default: 0 },
    items: [{
        code: String,
        name: String,
        qty: Number,
        cost: Number
    }],
    cashier: { type: String, required: true }
});

purchaseSchema.index({ tenantId: 1, date: -1 });

module.exports = mongoose.model('Purchase', purchaseSchema);
