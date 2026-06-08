const mongoose = require('../db');

const ExpenseSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    date: { type: String, required: true }, // ISO date string YYYY-MM-DD
    seller: { type: String },
    description: { type: String, required: true },
    amount: { type: Number, required: true },
    method: { type: String, default: 'cash' }
});

module.exports = mongoose.model('Expense', ExpenseSchema);
