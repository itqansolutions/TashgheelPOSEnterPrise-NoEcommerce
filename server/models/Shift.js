const mongoose = require('../db');

const shiftSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },
    cashier: { type: String, required: true },
    startTime: { type: Date, default: Date.now },
    endTime: Date,
    startCash: { type: Number, required: true },
    endCash: Number, // Expected cash
    actualCash: Number, // Counted cash
    actualCard: Number,
    actualMobile: Number,

    // Snapshot fields
    totalSales: { type: Number, default: 0 },
    cashSales: { type: Number, default: 0 },
    cardSales: { type: Number, default: 0 },
    mobileSales: { type: Number, default: 0 },
    returnsTotal: { type: Number, default: 0 },
    expensesTotal: { type: Number, default: 0 },

    status: { type: String, enum: ['open', 'closed'], default: 'open' },
    transactions: [{
        type: { type: String, enum: ['in', 'out'], required: true },
        amount: { type: Number, required: true },
        reason: String,
        time: { type: Date, default: Date.now }
    }]
});

shiftSchema.index({ tenantId: 1, status: 1 });

module.exports = mongoose.model('Shift', shiftSchema);
