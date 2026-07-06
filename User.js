const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  userId:    { type: Number, required: true, unique: true },
  username:  { type: String },
  firstName: { type: String },
  tarif:     { type: String, default: 'free' },

  // Autohabar sozlamalari
  groupMode:      { type: String, default: 'all' },     // 'all' | 'selected'
  selectedGroups: { type: [String], default: [] },      // tanlangan groupId lar
  interval:       { type: Number, default: 300 },       // soniyada
  isRunning:      { type: Boolean, default: false },
  autoStopLimit:  { type: Number, default: null },      // N marta yuborilgach avto-o'chish; null = cheksiz
  sentCount:      { type: Number, default: 0 },         // joriy tsiklda necha marta yuborilgani
  mentionEnabled: { type: Boolean, default: false },    // guruhga @mention qo'shib yuborish

  lastSeen:  { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);
