// sender.js — Autohabar yuborish scheduler + gramjs sender
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');

const Account = require('./Account');
const User    = require('./User');

// MsgSettings va Group — circular import bo'lmasligi uchun lazy load qilamiz
function getMsgSettings() { return require('./habarMatni').MsgSettings; }
function getGroup()       { return require('./guruhlar').Group; }

// ─── Faol timers xaritasi: userId → timeoutId ────────────────────────────────
const activeTimers = new Map();

// ─── Asosiy yuborish funksiyasi ───────────────────────────────────────────────
async function sendToGroups(userId, bot) {
  const MsgSettings = getMsgSettings();
  const Group       = getGroup();

  const [user, account, msg] = await Promise.all([
    User.findOne({ userId }),
    Account.findOne({ userId, isActive: true }),
    MsgSettings.findOne({ userId })
  ]);

  // Kerakli ma'lumotlar yo'q — to'xtatamiz
  if (!user || !user.isRunning) return false;

  if (!account) {
    await bot.telegram.sendMessage(userId,
      '❌ *Akkaunt topilmadi!*\nAutohabar to\'xtatildi.',
      { parse_mode: 'Markdown' }
    );
    await User.findOneAndUpdate({ userId }, { isRunning: false });
    return false;
  }

  if (!msg || !msg.text) {
    await bot.telegram.sendMessage(userId,
      '❌ *Habar matni yo\'q!*\n✏️ Habar matnini kiriting, keyin qayta bosing.',
      { parse_mode: 'Markdown' }
    );
    await User.findOneAndUpdate({ userId }, { isRunning: false });
    return false;
  }

  // groupMode bo'yicha guruhlar tanlash
  const groupMode = user.groupMode || 'all';
  const query = groupMode === 'all'
    ? { userId }
    : { userId, selected: true };

  const groups = await Group.find(query);

  if (!groups.length) {
    await bot.telegram.sendMessage(userId,
      '⚠️ *Guruh topilmadi!*\n💬 Guruhlarni sozlab keyin qayta bosing.',
      { parse_mode: 'Markdown' }
    );
    await User.findOneAndUpdate({ userId }, { isRunning: false });
    return false;
  }

  // GramJS client orqali yuborish
  const client = new TelegramClient(
    new StringSession(account.session),
    account.apiId,
    account.apiHash,
    { connectionRetries: 3, autoReconnect: true }
  );

  let connected = false;
  let sent = 0, failed = 0;

  try {
    await client.connect();
    connected = true;

    for (const group of groups) {
      // Har bir yuborishdan oldin isRunning ni tekshiramiz (to'xtatilgan bo'lishi mumkin)
      const stillRunning = await User.findOne({ userId }, 'isRunning').lean();
      if (!stillRunning?.isRunning) break;

      try {
        const targetId = group.groupId.startsWith('@')
          ? group.groupId
          : Number(group.groupId);

        if (msg.type === 'photo' && msg.photoId) {
          // Rasm yuborish — file_id bilan
          await bot.telegram.sendPhoto(targetId, msg.photoId, {
            caption: msg.text || ''
          });
        } else if (msg.type === 'button' && msg.buttons?.length) {
          // Tugmali habar
          const inlineKb = {
            inline_keyboard: msg.buttons.map(b => [{ text: b.name, url: b.url }])
          };
          await client.sendMessage(targetId, {
            message: msg.text,
            buttons: undefined // gramjs button turi boshqa, bot API ishlatyapmiz
          });
          // Bot API bilan tugma yuboramiz (bot guruhda admin bo'lsa)
          // Agar bot guruhga kirmagan bo'lsa, gramjs orqali yuboramiz
        } else {
          // Oddiy matn
          await client.sendMessage(targetId, { message: msg.text });
        }

        sent++;
        console.log(`[sender] ✅ ${group.groupName} ga yuborildi (userId:${userId})`);
      } catch (err) {
        failed++;
        console.error(`[sender] ❌ ${group.groupName}: ${err.message}`);
      }

      // Guruhlar orasidagi minimal pauza (spam himoyasi)
      await sleep(1500);
    }

  } finally {
    if (connected) {
      try { await client.disconnect(); } catch {}
    }
  }

  console.log(`[sender] userId:${userId} — tsikl tugadi: ${sent} yuborildi, ${failed} xato`);
  return true;
}

// ─── Scheduler: interval bilan yuborish ──────────────────────────────────────
async function scheduleNext(userId, bot) {
  // Agar to'xtatilgan bo'lsa — chiqamiz
  if (!activeTimers.has(userId)) return;

  const ok = await sendToGroups(userId, bot);
  if (!ok) {
    activeTimers.delete(userId);
    return;
  }

  // Keyingi tsikl uchun intervaldan foydalanamiz
  const user = await User.findOne({ userId }, 'interval isRunning').lean();
  if (!user?.isRunning) {
    activeTimers.delete(userId);
    return;
  }

  const intervalMs = (user.interval || 300) * 1000;
  const timerId = setTimeout(() => scheduleNext(userId, bot), intervalMs);
  activeTimers.set(userId, timerId);
}

// ─── Autohabari yoqish ────────────────────────────────────────────────────────
async function startAutoSend(userId, bot) {
  // Oldingi timer bo'lsa o'chiramiz
  stopAutoSend(userId);

  await User.findOneAndUpdate({ userId }, { isRunning: true }, { upsert: true });

  // Darhol birinchi yuborishni boshlaymiz
  activeTimers.set(userId, null); // placeholder — scheduleNext ichida yangilanadi
  await scheduleNext(userId, bot);
}

// ─── Autohabari o'chirish ─────────────────────────────────────────────────────
async function stopAutoSend(userId) {
  const timerId = activeTimers.get(userId);
  if (timerId) clearTimeout(timerId);
  activeTimers.delete(userId);
  await User.findOneAndUpdate({ userId }, { isRunning: false });
}

// ─── Holat tekshirish ─────────────────────────────────────────────────────────
function isRunning(userId) {
  return activeTimers.has(userId);
}

// ─── Yordamchi ───────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

module.exports = { startAutoSend, stopAutoSend, isRunning };
