const mongoose = require('mongoose');

const accountSchema = new mongoose.Schema({
  userId:   { type: Number, required: true, index: true },
  phone:    { type: String, required: true },
  apiId:    { type: Number, required: true },
  apiHash:  { type: String, required: true },
  session:  { type: String, required: true }, // GramJS StringSession — disk emas, DB da
  isActive: { type: Boolean, default: true },
  createdAt:{ type: Date, default: Date.now }
});

accountSchema.index({ userId: 1, phone: 1 }, { unique: true });

module.exports = mongoose.model('Account', accountSchema);
