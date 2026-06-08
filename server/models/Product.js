const mongoose = require('../db');

const productSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    name: { type: String, required: true },
    nameEn: String,
    barcode: { type: String },
    price: { type: Number, required: true },
    priceOnline: { type: Number, default: 0 },
    priceDelivery: { type: Number, default: 0 },
    cost: { type: Number, default: 0 },
    stock: { type: Number, default: 0 },
    minStock: { type: Number, default: 0 },
    stores: [{
        storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store' },
        stock: { type: Number, default: 0 }
    }],
    trackStock: { type: Boolean, default: true },
    active: { type: Boolean, default: true },
    category: String,
    categoryEn: String,
    imageUrl: String,
    onlineActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now }
});

productSchema.index({ tenantId: 1, barcode: 1 });

module.exports = mongoose.model('Product', productSchema);
