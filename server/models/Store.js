const mongoose = require('../db');

const storeSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    name: { type: String, required: true },
    location: String,
    createdAt: { type: Date, default: Date.now }
});

storeSchema.index({ tenantId: 1 });

module.exports = mongoose.model('Store', storeSchema);
