const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  userId:    { type: Number, required: true, unique: true },
  username:  { type: String },
  firstName: { type: String },
  tarif:     { type: String, default: 'free' },  // 'free' | 'pro'

  // ─── Autohabar sozlamalari ─────────────────────────────────────────────────
  // BUG FIX: bu maydonlar avval schemada yo'q edi → mongoose strict mode
  // ularni saqlamay, doim undefined qaytarardi → groupMode har doim 'all'
  // chiqardi, interval esa 300 ga tushib qolardi.
  groupMode:  { type: String, default: 'all' },   // 'all' | 'selected'
  interval:   { type: Number, default: 300 },     // soniyada (default 5 daqiqa)
  isRunning:  { type: Boolean, default: false },  // autohabar yoqilganmi

  lastSeen:  { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);
