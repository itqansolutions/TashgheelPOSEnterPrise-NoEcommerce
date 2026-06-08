const mongoose = require('../db');

const stockAdjustmentSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },
    date: { type: Date, default: Date.now },
    adjustedBy: { type: String, required: true },
    items: [{
        productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
        productName: String,
        oldStock: Number,
        newStock: Number,
        difference: Number,
        reason: String
    }]
});

stockAdjustmentSchema.index({ tenantId: 1, date: -1 });

module.exports = mongoose.model('StockAdjustment', stockAdjustmentSchema);
