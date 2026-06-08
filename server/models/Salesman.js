const mongoose = require('../db');

const SalesmanSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    name: { type: String, required: true },
    targets: [{
        month: Number,
        year: Number,
        target: Number
    }]
});

module.exports = mongoose.model('Salesman', SalesmanSchema);
