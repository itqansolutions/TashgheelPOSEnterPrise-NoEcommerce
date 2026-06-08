const mongoose = require('../db');

const auditLogSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    user: { type: String, required: true },
    action: { type: String, required: true }, // e.g., 'DELETE_PRODUCT', 'CLOSE_SHIFT'
    details: mongoose.Schema.Types.Mixed,
    timestamp: { type: Date, default: Date.now }
});

auditLogSchema.index({ tenantId: 1, timestamp: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
