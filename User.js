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

  // Referral / Pro
  referralCount: { type: Number, default: 0 },
  referredBy:    { type: Number, default: null },
  referralCounted: { type: Boolean, default: false },
  proExpiresAt:  { type: Date, default: null },

  lastSeen:  { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);
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
  sentCount:      { type: Number, default: 0 },         // joriy tsiklda necha marta yuborilgani (avto-o'chirish uchun)
  totalSentCount: { type: Number, default: 0 },         // umumiy — hech qachon reset bo'lmaydi
  todaySentCount: { type: Number, default: 0 },         // bugungi kun uchun
  todaySentDate:  { type: String, default: '' },        // 'YYYY-MM-DD' — kun almashsa reset qilinadi
  mentionEnabled: { type: Boolean, default: false },    // guruhga @mention qo'shib yuborish

  // Referral / Pro
  referralCount: { type: Number, default: 0 },
  referredBy:    { type: Number, default: null },
  referralCounted: { type: Boolean, default: false },
  proExpiresAt:  { type: Date, default: null },

  lastSeen:  { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);
