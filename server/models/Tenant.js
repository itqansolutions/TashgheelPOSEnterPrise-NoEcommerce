const mongoose = require('../db');

const tenantSchema = new mongoose.Schema({
  businessName: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  phone: { type: String, required: true },
  trialEndsAt: { type: Date, required: true },
  subscriptionEndsAt: { type: Date },
  isSubscribed: { type: Boolean, default: false },
  status: { type: String, enum: ['active', 'on_hold', 'suspended'], default: 'active' },
  subscriptionPlan: { type: String, default: 'free_trial' }, // free_trial, monthly, yearly
  createdAt: { type: Date, default: Date.now },
  settings: {
    shopName: String,
    shopAddress: String,
    shopLogo: String,
    footerMessage: String,
    taxRate: { type: Number, default: 0 },
    taxName: { type: String, default: "Tax" }
  }
});

module.exports = mongoose.model('Tenant', tenantSchema);
