const mongoose = require('../db');

const userSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    username: { type: String, required: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['admin', 'manager', 'cashier'], default: 'cashier' },
    fullName: { type: String, required: true },
    active: { type: Boolean, default: true },
    allowedStores: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Store' }],
    allowedPages: [{ type: String }],
    createdAt: { type: Date, default: Date.now }
});

// Compound index to ensure unique usernames within a tenant
userSchema.index({ tenantId: 1, username: 1 }, { unique: true });

module.exports = mongoose.model('User', userSchema);
