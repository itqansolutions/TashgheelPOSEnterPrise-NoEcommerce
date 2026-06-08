const mongoose = require('../db');

const ledgerTransactionSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    entityType: { type: String, enum: ['customer', 'supplier'], required: true },
    entityId: { type: mongoose.Schema.Types.ObjectId, required: true, refPath: 'entityType' },
    type: { type: String, enum: ['purchase', 'sale', 'payment', 'refund'], required: true },
    amount: { type: Number, required: true }, // Positive adds debt (purchase/sale), Negative reduces debt (payment)
    referenceId: { type: mongoose.Schema.Types.ObjectId }, // Purchase ID or Sale ID
    date: { type: Date, default: Date.now },
    notes: { type: String },
    cashier: { type: String }
});

ledgerTransactionSchema.index({ tenantId: 1, entityId: 1, date: -1 });

module.exports = mongoose.model('LedgerTransaction', ledgerTransactionSchema);
