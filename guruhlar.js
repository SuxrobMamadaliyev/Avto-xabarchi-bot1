const { Markup } = require('telegraf');
const { Scenes } = require('telegraf');
const mongoose = require('mongoose');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');

const Account = require('./Account');
const User    = require('./User');

const PAGE_SIZE = 20;

// ─── Group model ─────────────────────────────────────────────────────────────
const groupSchema = new mongoose.Schema({
  userId:    { type: Number, required: true },
  // BUG FIX: accountId qo'shildi — har bir akkauntning guruhlari alohida saqlanadi.
  // Avval yo'q edi → hamma akkaunt guruhlari bitta to'plamga tushardi →
  // B-akkaunt sync qilganda A-akkauntning guruhlari deleteMany bilan o'chib ketardi.
  accountId: { type: String, required: true },   // Account._id.toString()
  groupId:   { type: String, required: true },
  groupName: { type: String, required: true },
  selected:  { type: Boolean, default: true },
  order:     { type: Number, default: 0 },
  addedAt:   { type: Date, default: Date.now }
});
// Unique index endi accountId ni ham o'z ichiga oladi
groupSchema.index({ userId: 1, accountId: 1, groupId: 1 }, { unique: true });
const Group = mongoose.models.Group || mongoose.model('Group', groupSchema);

// ─── BigInt → String (precision yo'qotmaslik uchun) ──────────────────────────
function formatTelegramId(id) {
  if (typeof id === 'bigint') return id.toString();
  return String(id);
}

// ─── Guruhlar asosiy menyusi ──────────────────────────────────────────────────
async function guruhlarHandler(ctx) {
  const userId  = ctx.from.id;
  const account = await Account.findOne({ userId, isActive: true });
  const user    = await User.findOne({ userId });
  const mode    = user?.groupMode || 'all';

  let groupCount = 0, selectedCount = 0;
  if (account) {
    const aid = account._id.toString();
    groupCount    = await Group.countDocuments({ userId, accountId: aid });
    selectedCount = await Group.countDocuments({ userId, accountId: aid, selected: true });
  }

  const text =
    `💬 *Guruhlarni sozlash*\n` +
    `${'━'.repeat(22)}\n\n` +
    `📱 Akkaunt: ${account ? account.phone : '❌ Ulanmagan'}\n` +
    `📋 Rejim: ${mode === 'all' ? '🌐 Hamma guruhlarga' : `☑️ Tanlangan (${selectedCount} ta)`}\n` +
    `💬 Jami guruhlar: ${groupCount} ta`;

  const kb = Markup.inlineKeyboard([
    [
      Markup.button.callback('🌐 Hammaga', 'group_mode_all'),
      Markup.button.callback('☑️ Tanlash', 'group_mode_select')
    ],
    [Markup.button.callback('📋 Guruhlar ro\'yxati', 'gpg:0')],
    [Markup.button.callback('🔄 Yangilash (skaner)', 'gsy:0')],
    [Markup.button.callback('➕ ID qo\'lda qo\'shish', 'add_group_manual')],
    [Markup.button.callback('⬅️ Orqaga', 'main_menu')]
  ]);

  if (ctx.callbackQuery) {
    await ctx.answerCbQuery();
    try { return await ctx.editMessageText(text, { parse_mode: 'Markdown', ...kb }); } catch {}
  }
  return ctx.reply(text, { parse_mode: 'Markdown', ...kb });
}

async function groupModeAllAction(ctx) {
  await ctx.answerCbQuery();
  await User.findOneAndUpdate({ userId: ctx.from.id }, { groupMode: 'all' }, { upsert: true });
  await guruhlarHandler(ctx);
}

async function groupModeSelectAction(ctx) {
  await ctx.answerCbQuery();
  await User.findOneAndUpdate({ userId: ctx.from.id }, { groupMode: 'selected' }, { upsert: true });
  await showGroupList(ctx, 0, { edit: false });
}

// ─── GramJS orqali guruhlarni sinxronlash ────────────────────────────────────
async function syncGroupsFromAccount(userId, account) {
  const accountId = account._id.toString();

  const client = new TelegramClient(
    new StringSession(account.session),
    account.apiId,
    account.apiHash,
    { connectionRetries: 3 }
  );

  let connected = false;
  let dialogs   = [];

  try {
    await client.connect();
    connected = true;

    // iterDialogs — barcha dialoglarni avtomatik paginate qilib oladi
    try {
      for await (const dialog of client.iterDialogs()) {
        dialogs.push(dialog);
      }
    } catch (err) {
      console.warn('[guruhlar] iterDialogs xato, getDialogs fallback:', err.message);
      dialogs = await client.getDialogs({ limit: 500 }).catch(() => client.getDialogs());
    }

  } finally {
    if (connected) { try { await client.disconnect(); } catch {} }
  }

  if (!dialogs?.length) {
    console.log(`[guruhlar] hech qanday dialog topilmadi (userId:${userId})`);
    return await Group.find({ userId, accountId }).sort({ order: 1 });
  }

  const chatDialogs = dialogs.filter(d => d.isGroup || d.isChannel || d.isBroadcast);

  const syncedIds = [];
  let hadErrors = false, skipped = 0;

  for (let i = 0; i < chatDialogs.length; i++) {
    const d = chatDialogs[i];
    try {
      const groupId   = formatTelegramId(d.id);
      const groupName = (d.title || d.name || 'Nomsiz guruh').trim();
      if (!groupId) { skipped++; continue; }

      syncedIds.push(groupId);

      await Group.findOneAndUpdate(
        { userId, accountId, groupId },          // ← accountId bo'yicha scope
        {
          $set:       { userId, accountId, groupId, groupName, order: i },
          $setOnInsert: { selected: true }
        },
        { upsert: true }
      );
    } catch (err) {
      hadErrors = true; skipped++;
      console.error('[guruhlar] dialog saqlashda xato:', err.message);
    }
  }

  console.log(`[guruhlar] sync: ${syncedIds.length} saqlandi, ${skipped} o'tkazildi (userId:${userId}, account:${account.phone})`);

  // Faqat bu akkauntdan chiqib ketilgan guruhlarni o'chiramiz
  if (!hadErrors && syncedIds.length > 0) {
    await Group.deleteMany({ userId, accountId, groupId: { $nin: syncedIds } });
  }

  return await Group.find({ userId, accountId }).sort({ order: 1 });
}

// ─── Sahifalangan guruhlar ro'yxati ──────────────────────────────────────────
async function showGroupList(ctx, page = 0, { forceSync = false, edit = false } = {}) {
  const userId  = ctx.from.id;
  const account = await Account.findOne({ userId, isActive: true });

  if (!account) {
    const text = '⚠️ *Avval akkaunt ulang!*';
    const kb   = Markup.inlineKeyboard([
      [Markup.button.callback('➕ Akkaunt qo\'shish', 'add_account')],
      [Markup.button.callback('⬅️ Orqaga', 'guruhlar_menu')]
    ]);
    if (edit) return ctx.editMessageText(text, { parse_mode: 'Markdown', ...kb });
    return ctx.reply(text, { parse_mode: 'Markdown', ...kb });
  }

  const accountId = account._id.toString();
  let groups = await Group.find({ userId, accountId }).sort({ order: 1 });

  if (forceSync || groups.length === 0) {
    const loading = edit ? null : await ctx.reply('⏳ Guruhlar yuklanmoqda...');
    try {
      groups = await syncGroupsFromAccount(userId, account);
    } catch (err) {
      if (loading) { try { await ctx.telegram.deleteMessage(ctx.chat.id, loading.message_id); } catch {} }
      const text = `❌ *Guruhlarni yuklab bo'lmadi*\n\n🔍 Xato: ${err.message}`;
      const kb   = Markup.inlineKeyboard([
        [Markup.button.callback('🔄 Qayta urinish', 'gsy:0')],
        [Markup.button.callback('⬅️ Orqaga', 'guruhlar_menu')]
      ]);
      if (edit) return ctx.editMessageText(text, { parse_mode: 'Markdown', ...kb });
      return ctx.reply(text, { parse_mode: 'Markdown', ...kb });
    }
    if (loading) { try { await ctx.telegram.deleteMessage(ctx.chat.id, loading.message_id); } catch {} }
    page = 0;
  }

  if (groups.length === 0) {
    const text = '📋 *Guruhlar topilmadi*\n\nAkkaunt hech qanday guruhga a\'zo emas.';
    const kb   = Markup.inlineKeyboard([
      [Markup.button.callback('🔄 Yangilash', 'gsy:0')],
      [Markup.button.callback('➕ ID qo\'lda qo\'shish', 'add_group_manual')],
      [Markup.button.callback('⬅️ Orqaga', 'guruhlar_menu')]
    ]);
    if (edit) return ctx.editMessageText(text, { parse_mode: 'Markdown', ...kb });
    return ctx.reply(text, { parse_mode: 'Markdown', ...kb });
  }

  const totalCount  = groups.length;
  const totalPages  = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  page = Math.min(Math.max(0, page), totalPages - 1);

  const selectedCount = groups.filter(g => g.selected).length;
  const pageItems     = groups.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const text =
    `Guruhlarni tanlang (${selectedCount} ta)\n` +
    `Jami: ${totalCount} ta\n` +
    `📱 ${account.phone}\n` +
    `➕ Tanlanmagan   ✔️ Tanlangan`;

  const rows = [];
  for (let i = 0; i < pageItems.length; i += 2) {
    const row = [buttonFor(pageItems[i], page)];
    if (pageItems[i + 1]) row.push(buttonFor(pageItems[i + 1], page));
    rows.push(row);
  }

  const navRow = [];
  if (page > 0)              navRow.push(Markup.button.callback('⬅️ Oldingi', `gpg:${page - 1}`));
  if (page < totalPages - 1) navRow.push(Markup.button.callback('Keyingi ➡️', `gpg:${page + 1}`));
  if (navRow.length) rows.push(navRow);

  rows.push([
    Markup.button.callback('☑️ Hammasini tanlash', `gsa:${page}`),
    Markup.button.callback(`💾 Saqlash (${selectedCount} ta)`, `gsv:${page}`)
  ]);
  rows.push([
    Markup.button.callback('🔄 Yangilash', 'gsy:0'),
    Markup.button.callback('⬅️ Orqaga', 'guruhlar_menu')
  ]);

  const kb = Markup.inlineKeyboard(rows);
  if (edit) { try { return await ctx.editMessageText(text, kb); } catch {} }
  return ctx.reply(text, kb);
}

function buttonFor(g, page) {
  return Markup.button.callback(
    `${g.selected ? '✔️' : '➕'} ${truncate(g.groupName, 24)}`,
    `tgl:${g._id}:${page}`
  );
}
function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

// ─── Actions ─────────────────────────────────────────────────────────────────
async function toggleGroupAction(ctx) {
  const [, id, pageStr] = ctx.callbackQuery.data.split(':');
  const group = await Group.findOne({ _id: id, userId: ctx.from.id });
  if (!group) return ctx.answerCbQuery('❌ Guruh topilmadi', { show_alert: true });
  group.selected = !group.selected;
  await group.save();
  await ctx.answerCbQuery(group.selected ? '✅ Tanlandi' : '➕ Bekor qilindi');
  await showGroupList(ctx, parseInt(pageStr, 10) || 0, { edit: true });
}

async function groupPageAction(ctx) {
  await ctx.answerCbQuery();
  await showGroupList(ctx, parseInt(ctx.callbackQuery.data.split(':')[1], 10) || 0, { edit: true });
}

async function groupSelectAllAction(ctx) {
  const page    = parseInt(ctx.callbackQuery.data.split(':')[1], 10) || 0;
  const account = await Account.findOne({ userId: ctx.from.id, isActive: true });
  if (!account) return ctx.answerCbQuery('❌ Akkaunt topilmadi', { show_alert: true });
  await Group.updateMany({ userId: ctx.from.id, accountId: account._id.toString() }, { selected: true });
  await ctx.answerCbQuery('✅ Barcha guruhlar tanlandi');
  await showGroupList(ctx, page, { edit: true });
}

async function groupSaveAction(ctx) {
  const page    = parseInt(ctx.callbackQuery.data.split(':')[1], 10) || 0;
  const account = await Account.findOne({ userId: ctx.from.id, isActive: true });
  const aid     = account?._id.toString();
  const count   = aid
    ? await Group.countDocuments({ userId: ctx.from.id, accountId: aid, selected: true })
    : 0;
  await User.findOneAndUpdate({ userId: ctx.from.id }, { groupMode: 'selected' }, { upsert: true });
  await ctx.answerCbQuery(`💾 Saqlandi! ${count} ta guruh tanlangan`, { show_alert: true });
  await showGroupList(ctx, page, { edit: true });
}

async function groupSyncAction(ctx) {
  await ctx.answerCbQuery('🔄 Yangilanmoqda...');
  await showGroupList(ctx, 0, { forceSync: true, edit: false });
}

// ─── Guruh qo'lda qo'shish scene ─────────────────────────────────────────────
const addGroupScene = new Scenes.WizardScene(
  'ADD_GROUP',

  async (ctx) => {
    await ctx.reply(
      '➕ *Guruh ID kiriting:*\n\n' +
      'Guruh ID olish:\n' +
      '1. Botni guruhga qo\'shing\n' +
      '2. `/id` yozing\n\n' +
      'Yoki username: `@guruhusername`',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('❌ Bekor', 'cancel_add_group')]])
      }
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (ctx.callbackQuery?.data === 'cancel_add_group') {
      await ctx.answerCbQuery();
      return ctx.scene.leave();
    }
    const input = ctx.message?.text?.trim();
    if (!input) return;

    const account = await Account.findOne({ userId: ctx.from.id, isActive: true });
    if (!account) {
      await ctx.reply('❌ Akkaunt topilmadi!');
      return ctx.scene.leave();
    }

    const groupId   = input;
    const groupName = input.startsWith('@') ? input : `Guruh ${input}`;
    const accountId = account._id.toString();

    try {
      await Group.findOneAndUpdate(
        { userId: ctx.from.id, accountId, groupId },
        { userId: ctx.from.id, accountId, groupId, groupName, selected: true },
        { upsert: true, new: true }
      );
      await ctx.reply(`✅ *${groupName}* qo'shildi!`, { parse_mode: 'Markdown' });
      await ctx.scene.leave();
      await showGroupList(ctx, 0);
    } catch (err) {
      console.error('[guruhlar] guruh qo\'shishda xato:', err.message);
      await ctx.reply('❌ Xatolik. Qayta kiriting:');
    }
  }
);
addGroupScene.action('cancel_add_group', async (ctx) => { await ctx.answerCbQuery(); await ctx.scene.leave(); });

// ─── Bot guruhga qo'shilganda ─────────────────────────────────────────────────
async function onBotAddedToGroup(ctx) {
  if (!ctx.chat || !['group', 'supergroup'].includes(ctx.chat.type)) return;
  const admins  = await ctx.telegram.getChatAdministrators(ctx.chat.id);
  const isAdmin = admins.some(a => a.user.id === ctx.botInfo.id);
  if (!isAdmin) return;

  for (const admin of admins) {
    if (admin.user.is_bot) continue;
    const account = await Account.findOne({ userId: admin.user.id, isActive: true });
    if (!account) continue;
    try {
      await Group.findOneAndUpdate(
        { userId: admin.user.id, accountId: account._id.toString(), groupId: String(ctx.chat.id) },
        {
          userId:    admin.user.id,
          accountId: account._id.toString(),
          groupId:   String(ctx.chat.id),
          groupName: ctx.chat.title || 'Noma\'lum guruh',
          selected:  true
        },
        { upsert: true }
      );
    } catch (err) {
      console.error('[guruhlar] bot qo\'shilishda xato:', err.message);
    }
  }
}

module.exports = {
  guruhlarHandler,
  groupModeAllAction,
  groupModeSelectAction,
  toggleGroupAction,
  groupPageAction,
  groupSelectAllAction,
  groupSaveAction,
  groupSyncAction,
  addGroupScene,
  onBotAddedToGroup,
  Group
};
