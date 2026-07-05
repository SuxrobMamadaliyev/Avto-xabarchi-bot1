const { TelegramClient } = require('telegram');
const { StringSession }  = require('telegram/sessions');
const Account = require('./Account');
const User    = require('./User');

function getMsgSettings() { return require('./habarMatni').MsgSettings; }
function fetchLiveGroups() { return require('./guruhlar').fetchLiveGroups; }

const activeTimers = new Map();

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

  // ─── Guruhlarni aniqlash ───────────────────────────────────────────────────
  let targets = []; // [{ groupId, groupName }]

  const groupMode = user.groupMode || 'all';

  if (groupMode === 'selected') {
    // Faqat tanlangan IDlar — MongoDB ga urmasdan to'g'ridan-to'g'ri yuboramiz
    targets = (user.selectedGroups || []).map(id => ({ groupId: id, groupName: id }));
  } else {
    // Hamma guruhlar — GramJS dan live olamiz
    try {
      const getLive = fetchLiveGroups();
      targets = await getLive(account);
    } catch (err) {
      console.error('[sender] live guruhlar olinmadi:', err.message);
      // Fallback: selectedGroups ishlatamiz
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
      // Har qadam oldida isRunning tekshiramiz
      const still = await User.findOne({ userId }, 'isRunning').lean();
      if (!still?.isRunning) break;

      try {
        const targetId = group.groupId.startsWith('-') || /^\d/.test(group.groupId)
          ? BigInt(group.groupId)   // raqamli ID — BigInt sifatida
          : group.groupId;          // @username

        await client.sendMessage(targetId, { message: msg.text });
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
  await User.findOneAndUpdate({ userId }, { isRunning: true }, { upsert: true });
  activeTimers.set(userId, null);
  scheduleNext(userId, bot); // async, kutmaymiz
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
