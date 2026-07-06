const { TelegramClient } = require('telegram');
const { StringSession }  = require('telegram/sessions');
const Account = require('./Account');
const User    = require('./User');

function getMsgSettings() { return require('./habarMatni').MsgSettings; }
function fetchLiveGroups() { return require('./guruhlar').fetchLiveGroups; }

const activeTimers = new Map();

// ─── Free tarif watermark ─────────────────────────────────────────────────────
const WATERMARK = '\n\n〰️〰️〰️\n🤖 @Autoxabarcbot orqali yuborildi';

// ─── Mention: guruhdan bir nechta a'zoni @ qilib chaqirish (Pro funksiyasi) ──
async function buildMentionSuffix(client, targetId) {
  try {
    const participants = await client.getParticipants(targetId, { limit: 30 });
    // Faqat username'i bor, bot bo'lmagan foydalanuvchilarni tanlaymiz
    const candidates = participants.filter(p => p.username && !p.bot);
    if (!candidates.length) return '';

    // Tasodifiy 3 tagacha a'zoni tanlaymiz (spam ko'rinishini kamaytirish uchun)
    const shuffled = candidates.sort(() => Math.random() - 0.5).slice(0, 3);
    const mentions = shuffled.map(u => `@${u.username}`).join(' ');
    return `\n\n${mentions}`;
  } catch (err) {
    console.error('[sender] mention olishda xato:', err.message);
    return '';
  }
}

async function sendToGroups(userId, bot) {
  const MsgSettings = getMsgSettings();

  const [user, account, msg] = await Promise.all([
    User.findOne({ userId }),
    Account.findOne({ userId, isActive: true }),
    MsgSettings.findOne({ userId })
  ]);

  if (!user?.isRunning) return false;

  if (!account) {
    await bot.telegram.sendMessage(userId,
      '❌ *Akkaunt topilmadi!*\nAutohabar to\'xtatildi.',
      { parse_mode: 'Markdown' }
    );
    await User.findOneAndUpdate({ userId }, { isRunning: false });
    return false;
  }

  if (!msg?.text) {
    await bot.telegram.sendMessage(userId,
      '❌ *Habar matni yo\'q!*\n✏️ Habar matnini kiriting.',
      { parse_mode: 'Markdown' }
    );
    await User.findOneAndUpdate({ userId }, { isRunning: false });
    return false;
  }

  // ─── Pro / Free tekshiruvi ────────────────────────────────────────────────
  const isPro = user.tarif === 'pro' && (!user.proExpiresAt || user.proExpiresAt > new Date());
  const mentionOn = isPro && user.mentionEnabled; // mention faqat Pro'da ishlaydi

  // ─── Avto-o'chirish limiti tekshiruvi ────────────────────────────────────
  if (user.autoStopLimit && user.sentCount >= user.autoStopLimit) {
    await bot.telegram.sendMessage(userId,
      `⏱ *Avto-o'chirish limitiga yetdingiz!*\n\n${user.autoStopLimit} marta yuborilgach avtomatik to'xtatildi.`,
      { parse_mode: 'Markdown' }
    );
    await User.findOneAndUpdate({ userId }, { isRunning: false, sentCount: 0 });
    return false;
  }

  // ─── Guruhlarni aniqlash ───────────────────────────────────────────────────
  let targets = []; // [{ groupId, groupName }]

  const groupMode = user.groupMode || 'all';

  if (groupMode === 'selected') {
    targets = (user.selectedGroups || []).map(id => ({ groupId: id, groupName: id }));
  } else {
    try {
      const getLive = fetchLiveGroups();
      targets = await getLive(account);
    } catch (err) {
      console.error('[sender] live guruhlar olinmadi:', err.message);
      targets = (user.selectedGroups || []).map(id => ({ groupId: id, groupName: id }));
    }
  }

  if (!targets.length) {
    await bot.telegram.sendMessage(userId,
      '⚠️ *Guruh topilmadi!*\n💬 Guruhlarni sozlab qayta bosing.',
      { parse_mode: 'Markdown' }
    );
    await User.findOneAndUpdate({ userId }, { isRunning: false });
    return false;
  }

  // ─── GramJS client ────────────────────────────────────────────────────────
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

    for (const group of targets) {
      const still = await User.findOne({ userId }, 'isRunning').lean();
      if (!still?.isRunning) break;

      try {
        const targetId = group.groupId.startsWith('-') || /^\d/.test(group.groupId)
          ? BigInt(group.groupId)
          : group.groupId;

        // ─── Xabar matnini tayyorlash: base + mention (Pro) + watermark (Free) ──
        let finalText = msg.text;

        if (mentionOn) {
          const mentionSuffix = await buildMentionSuffix(client, targetId);
          finalText += mentionSuffix;
        }

        if (!isPro) {
          finalText += WATERMARK; // Free tarifda majburiy watermark
        }

        await client.sendMessage(targetId, { message: finalText });
        sent++;
        console.log(`[sender] ✅ ${group.groupName} (userId:${userId})`);
      } catch (err) {
        failed++;
        console.error(`[sender] ❌ ${group.groupName}: ${err.message}`);
      }

      await sleep(1500); // spam himoyasi
    }
  } finally {
    if (connected) { try { await client.disconnect(); } catch {} }
  }

  // ─── Yuborilgan sonini hisoblash (statistika + avto-o'chirish uchun) ──────
  if (sent > 0) {
    const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
    const fresh = await User.findOne({ userId }, 'todaySentDate').lean();

    if (fresh?.todaySentDate !== today) {
      // Kun almashgan — kunlik hisoblagichni nolga tushirib, keyin qo'shamiz
      await User.findOneAndUpdate({ userId }, { todaySentCount: 0, todaySentDate: today });
    }

    await User.findOneAndUpdate(
      { userId },
      { $inc: { sentCount: sent, totalSentCount: sent, todaySentCount: sent } }
    );
  }

  console.log(`[sender] userId:${userId} — ${sent} yuborildi, ${failed} xato`);
  return true;
}

// ─── Scheduler ────────────────────────────────────────────────────────────────
async function scheduleNext(userId, bot) {
  if (!activeTimers.has(userId)) return;

  const ok = await sendToGroups(userId, bot);
  if (!ok) { activeTimers.delete(userId); return; }

  const user = await User.findOne({ userId }, 'interval isRunning').lean();
  if (!user?.isRunning) { activeTimers.delete(userId); return; }

  const ms = (user.interval || 300) * 1000;
  const t  = setTimeout(() => scheduleNext(userId, bot), ms);
  activeTimers.set(userId, t);
}

async function startAutoSend(userId, bot) {
  stopAutoSend(userId);
  await User.findOneAndUpdate({ userId }, { isRunning: true, sentCount: 0 }, { upsert: true });
  activeTimers.set(userId, null);
  scheduleNext(userId, bot);
}

async function stopAutoSend(userId) {
  const t = activeTimers.get(userId);
  if (t) clearTimeout(t);
  activeTimers.delete(userId);
  await User.findOneAndUpdate({ userId }, { isRunning: false });
}

function isRunning(userId) { return activeTimers.has(userId); }
function sleep(ms)         { return new Promise(r => setTimeout(r, ms)); }

module.exports = { startAutoSend, stopAutoSend, isRunning };
