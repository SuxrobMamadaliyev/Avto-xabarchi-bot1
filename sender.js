const { TelegramClient } = require('telegram');
const { StringSession }  = require('telegram/sessions');
const Account = require('./Account');
const User    = require('./User');

function getMsgSettings() { return require('./habarMatni').MsgSettings; }
function getGroup()       { return require('./guruhlar').Group; }

const activeTimers = new Map();

async function sendToGroups(userId, bot) {
  const MsgSettings = getMsgSettings();
  const Group       = getGroup();

  const [user, account, msg] = await Promise.all([
    User.findOne({ userId }),
    Account.findOne({ userId, isActive: true }),
    MsgSettings.findOne({ userId })
  ]);

  if (!user?.isRunning) return false;

  if (!account) {
    await bot.telegram.sendMessage(userId, '❌ *Akkaunt topilmadi!*\nAutohabar to\'xtatildi.', { parse_mode: 'Markdown' });
    await User.findOneAndUpdate({ userId }, { isRunning: false });
    return false;
  }
  if (!msg?.text) {
    await bot.telegram.sendMessage(userId, '❌ *Habar matni yo\'q!*\n✏️ Habar matnini kiriting.', { parse_mode: 'Markdown' });
    await User.findOneAndUpdate({ userId }, { isRunning: false });
    return false;
  }

  const accountId   = account._id.toString();
  const groupMode   = user.groupMode || 'all';
  // BUG FIX: accountId bo'yicha scope — faqat shu akkauntning guruhlarini oladi
  const query = groupMode === 'all'
    ? { userId, accountId }
    : { userId, accountId, selected: true };

  const groups = await Group.find(query);

  if (!groups.length) {
    await bot.telegram.sendMessage(userId, '⚠️ *Guruh topilmadi!*\n💬 Guruhlarni sozlab qayta bosing.', { parse_mode: 'Markdown' });
    await User.findOneAndUpdate({ userId }, { isRunning: false });
    return false;
  }

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
      const stillRunning = await User.findOne({ userId }, 'isRunning').lean();
      if (!stillRunning?.isRunning) break;

      try {
        const targetId = group.groupId.startsWith('@')
          ? group.groupId
          : Number(group.groupId);

        await client.sendMessage(targetId, { message: msg.text });
        sent++;
        console.log(`[sender] ✅ ${group.groupName} (userId:${userId})`);
      } catch (err) {
        failed++;
        console.error(`[sender] ❌ ${group.groupName}: ${err.message}`);
      }

      await sleep(1500);
    }
  } finally {
    if (connected) { try { await client.disconnect(); } catch {} }
  }

  console.log(`[sender] userId:${userId} — ${sent} yuborildi, ${failed} xato`);
  return true;
}

async function scheduleNext(userId, bot) {
  if (!activeTimers.has(userId)) return;
  const ok = await sendToGroups(userId, bot);
  if (!ok) { activeTimers.delete(userId); return; }

  const user = await User.findOne({ userId }, 'interval isRunning').lean();
  if (!user?.isRunning) { activeTimers.delete(userId); return; }

  const ms      = (user.interval || 300) * 1000;
  const timerId = setTimeout(() => scheduleNext(userId, bot), ms);
  activeTimers.set(userId, timerId);
}

async function startAutoSend(userId, bot) {
  stopAutoSend(userId);
  await User.findOneAndUpdate({ userId }, { isRunning: true }, { upsert: true });
  activeTimers.set(userId, null);
  await scheduleNext(userId, bot);
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
