const mongoose = require('../db');

const categorySchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    name: { type: String, required: true },
    nameEn: String,
    createdAt: { type: Date, default: Date.now }
});

categorySchema.index({ tenantId: 1, name: 1 });

module.exports = mongoose.model('Category', categorySchema);
