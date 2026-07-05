const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  userId:    { type: Number, required: true, unique: true },
  username:  { type: String },
  firstName: { type: String },
  tarif:     { type: String, default: 'free' }, // 'free' | 'pro'
  lastSeen:  { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);
