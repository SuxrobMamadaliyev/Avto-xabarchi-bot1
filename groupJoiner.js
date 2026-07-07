const { TelegramClient } = require('telegram');
const { StringSession }  = require('telegram/sessions');
const { Api } = require('telegram');
const Account = require('./Account');

// ─── Havoladan taklif hash'ini ajratib olish (https://t.me/+xxxx yoki /joinchat/xxxx) ──
function extractInviteHash(target) {
  const m = target.match(/(?:joinchat\/|\+)([\w-]+)/);
  return m ? m[1] : null;
}

// ─── Bitta akkauntni gurux/kanalga qo'shish ──────────────────────────────────
async function joinGroupWithAccount(account, target) {
  const client = new TelegramClient(
    new StringSession(account.session),
    account.apiId,
    account.apiHash,
    { connectionRetries: 3 }
  );

  let connected = false;
  try {
    await client.connect();
    connected = true;

    const inviteHash = extractInviteHash(target);

    if (inviteHash) {
      // Xususiy taklif havolasi
      await client.invoke(new Api.messages.ImportChatInvite({ hash: inviteHash }));
    } else {
      // Ochiq username (@nomi yoki https://t.me/nomi)
      const username = target
        .replace(/^https?:\/\/t\.me\//i, '')
        .replace(/^@/, '')
        .trim();
      const entity = await client.getEntity(username);
      await client.invoke(new Api.channels.JoinChannel({ channel: entity }));
    }

    return { ok: true, phone: account.phone };
  } catch (err) {
    return { ok: false, phone: account.phone, error: err.message };
  } finally {
    if (connected) { try { await client.disconnect(); } catch {} }
  }
}

// ─── Barcha (yoki tanlangan) akkauntlarni gurux/kanalga qo'shish ─────────────
async function joinAllAccountsToGroup(target, onProgress) {
  const accounts = await Account.find({ isActive: true });
  let success = 0, failed = 0;
  const results = [];

  for (const acc of accounts) {
    const res = await joinGroupWithAccount(acc, target);
    if (res.ok) success++; else failed++;
    results.push(res);

    if (onProgress) {
      try { await onProgress({ done: success + failed, total: accounts.length, success, failed, last: res }); } catch {}
    }

    await sleep(2500); // flood-wait / spam himoyasi uchun akkauntlar orasida kutish
  }

  return { total: accounts.length, success, failed, results };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { joinAllAccountsToGroup, joinGroupWithAccount };
