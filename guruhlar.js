const { Markup } = require('telegraf');
const { Scenes } = require('telegraf');
const mongoose = require('mongoose');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');

const Account = require('./Account');
const User = require('./User');

const PAGE_SIZE = 20; // 10 qator x 2 ustun (rasmdagidek)

// ─── Group model (inline) ───────────────────────────────────────────────────
const groupSchema = new mongoose.Schema({
  userId:    { type: Number, required: true },
  groupId:   { type: String, required: true },
  groupName: { type: String, required: true },
  selected:  { type: Boolean, default: true },
  order:     { type: Number, default: 0 },
  addedAt:   { type: Date, default: Date.now }
});
groupSchema.index({ userId: 1, groupId: 1 }, { unique: true });
const Group = mongoose.models.Group || mongoose.model('Group', groupSchema);

// ─── Telegramda Group/Channel ID sini to'g'ri formatlash ──────────────────
function formatTelegramId(id) {
  // Telegram channellari uchun manfi raqam beradi, guruhlar uchun musbat
  // GramJS/telegram-client lar buni BigInt sifatida berishi mumkin
  const numId = typeof id === 'bigint' ? Number(id) : Number(id);
  return String(numId);
}

// ─── Guruhlarni sozlash asosiy menyu ────────────────────────────────────────
async function guruhlarHandler(ctx) {
  const user = await User.findOne({ userId: ctx.from.id });
  const groupMode = user?.groupMode || 'all'; // 'all' | 'selected'

  const groups = await Group.find({ userId: ctx.from.id });
  const selectedCount = groups.filter(g => g.selected).length;

  await ctx.reply(
    `🎯 *Guruhlarni sozlash*\n\n` +
    `Qaysi guruhlarga xabar yuboramiz?\n` +
    `✔️ Tanlangan\n` +
    `➕ Tanlanmagan\n\n` +
    `📌 Hozirgi tanlov: *${groupMode === 'all' ? 'Hamma guruhlarga' : `${selectedCount} ta tanlangan guruh`}*\n\n` +
    `🗂 Guruhlarni tanlang`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✔️ Hamma guruhlarga', 'group_mode_all')],
        [Markup.button.callback('➕ O\'zim tanlayman', 'group_mode_select')],
        [Markup.button.callback('⬅️ Orqaga', 'main_menu')]
      ])
    }
  );
}

// Hamma guruhlarga rejimi
async function groupModeAllAction(ctx) {
  await ctx.answerCbQuery();
  await User.findOneAndUpdate(
    { userId: ctx.from.id },
    { groupMode: 'all' },
    { upsert: true }
  );

  await ctx.editMessageText(
    `🎯 *Guruhlarni sozlash*\n\n` +
    `Qaysi guruhlarga xabar yuboramiz?\n` +
    `✔️ Tanlangan\n` +
    `➕ Tanlanmagan\n\n` +
    `📌 Hozirgi tanlov: *Hamma guruhlarga*\n\n` +
    `🗂 Guruhlarni tanlang`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✔️ Hamma guruhlarga', 'group_mode_all')],
        [Markup.button.callback('➕ O\'zim tanlayman', 'group_mode_select')],
        [Markup.button.callback('⬅️ Orqaga', 'main_menu')]
      ])
    }
  );
}

// O'zim tanlayman — ulangan akkauntdagi guruhlar ro'yxati
async function groupModeSelectAction(ctx) {
  await ctx.answerCbQuery();
  await User.findOneAndUpdate(
    { userId: ctx.from.id },
    { groupMode: 'selected' },
    { upsert: true }
  );

  await showGroupList(ctx, 0);
}

// ─── Ulangan akkaunt orqali guruhlarni Telegramdan sinxronlash ──────────────
async function syncGroupsFromAccount(userId, account) {
  const client = new TelegramClient(
    new StringSession(account.session),
    account.apiId,
    account.apiHash,
    { connectionRetries: 3 }
  );

  let connected = false;
  let dialogs = [];

  try {
    await client.connect();
    connected = true;

    // Dialoglarnin o'chirilish: limit: 0 ba'zi GramJS versiyalarida
    // notog'ri ishlasligi mumkin, shuning uchun katta limit beramiz
    try {
      dialogs = await client.getDialogs({ limit: 500 });
    } catch (err) {
      console.warn('[guruhlar] getDialogs limit:500 bilan xato, limit:100 bilan urinish:', err.message);
      try {
        dialogs = await client.getDialogs({ limit: 100 });
      } catch (err2) {
        console.warn('[guruhlar] getDialogs limit:100 ham xato, limit asiz urinish:', err2.message);
        dialogs = await client.getDialogs();
      }
    }

  } finally {
    if (connected) {
      try { await client.disconnect(); } catch {}
    }
  }

  if (!dialogs || dialogs.length === 0) {
    console.log(`[guruhlar] sync: hech qanday dialog topilmadi (userId: ${userId})`);
    return await Group.find({ userId }).sort({ order: 1 });
  }

  // Faqat guruh va kanallar (shaxsiy chatlar/botlar chiqarib tashlanadi)
  // Telegram-client uchun: isGroup, isBroadcast (kanal)
  const chatDialogs = dialogs.filter(d => {
    return (d.isGroup || d.isChannel || d.isBroadcast);
  });

  const syncedIds = [];
  let hadErrors = false;
  let skippedCount = 0;

  for (let i = 0; i < chatDialogs.length; i++) {
    const d = chatDialogs[i];
    try {
      // ID ni to'g'ri formatla (BigInt bo'lishi mumkin)
      const groupId = formatTelegramId(d.id);
      const groupName = (d.title || d.name || 'Nomsiz guruh').trim();

      if (!groupId) {
        skippedCount++;
        console.warn('[guruhlar] groupId aniqlanmadi, o\'tkazib yuborildi');
        continue;
      }

      syncedIds.push(groupId);

      await Group.findOneAndUpdate(
        { userId, groupId },
        {
          $set: { userId, groupId, groupName, order: i },
          $setOnInsert: { selected: true }
        },
        { upsert: true }
      );

    } catch (err) {
      hadErrors = true;
      skippedCount++;
      console.error('[guruhlar] dialog sinxronlashda xato:', err.message);
    }
  }

  console.log(
    `[guruhlar] sync: ${syncedIds.length} ta saqlandi, ` +
    `${skippedCount} ta o'tkazib yuborildi (jami: ${chatDialogs.length}, userId: ${userId})`
  );

  // Akkaunt endi a'zo bo'lmagan guruhlarni ro'yxatdan olib tashlaymiz.
  // MUHIM: agar sinxronlashda xatolar bo'lgan bo'lsa (ba'zi guruhlar
  // o'qilmagan bo'lishi mumkin), tozalashni o'tkazib yuboramiz.
  if (!hadErrors && syncedIds.length > 0) {
    await Group.deleteMany({ userId, groupId: { $nin: syncedIds } });
  } else if (!hadErrors && syncedIds.length === 0) {
    // Agar hech qanday ID saqlanganligi bo'lmasa, barcha guruhlarni o'chirib tashlash xavfli
    console.warn('[guruhlar] hech qanday guruh saqlanganligi yo\'q, bazani o\'chirishdik o\'tkazib yubolmoqda');
  }

  return await Group.find({ userId }).sort({ order: 1 });
}

// ─── Sahifalangan guruhlar ro'yxatini chizish ───────────────────────────────
async function showGroupList(ctx, page = 0, { forceSync = false, edit = false } = {}) {
  const userId = ctx.from.id;
  const account = await Account.findOne({ userId, isActive: true });

  if (!account) {
    const text =
      '⚠️ *Avval akkaunt ulang!*\n\n' +
      'Guruhlaringizni ko\'rish uchun avval Telegram akkauntingizni ulashingiz kerak.';
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback('➕ Akkaunt qo\'shish', 'add_account')],
      [Markup.button.callback('⬅️ Orqaga', 'guruhlar_menu')]
    ]);
    if (edit) return ctx.editMessageText(text, { parse_mode: 'Markdown', ...kb });
    return ctx.reply(text, { parse_mode: 'Markdown', ...kb });
  }

  let groups = await Group.find({ userId }).sort({ order: 1 });

  if (forceSync || groups.length === 0) {
    const loading = edit ? null : await ctx.reply('⏳ Guruhlar yuklanmoqda...');
    try {
      groups = await syncGroupsFromAccount(userId, account);
    } catch (err) {
      console.error('[guruhlar] sync xato:', err.message);
      if (loading) { 
        try { await ctx.telegram.deleteMessage(ctx.chat.id, loading.message_id); } catch {} 
      }
      const text =
        '❌ *Guruhlarni yuklab bo\'lmadi*\n\n' +
        'Akkaunt sessiyasi eskirgan bo\'lishi mumkin. Akkauntni qayta ulab ko\'ring.\n\n' +
        '🔍 Xato: ' + err.message;
      const kb = Markup.inlineKeyboard([
        [Markup.button.callback('🔄 Qayta urinish', 'gsy:0')],
        [Markup.button.callback('⬅️ Orqaga', 'guruhlar_menu')]
      ]);
      if (edit) return ctx.editMessageText(text, { parse_mode: 'Markdown', ...kb });
      return ctx.reply(text, { parse_mode: 'Markdown', ...kb });
    }
    if (loading) { 
      try { await ctx.telegram.deleteMessage(ctx.chat.id, loading.message_id); } catch {} 
    }
    page = 0;
  }

  if (groups.length === 0) {
    const text =
      '📋 *Guruhlar topilmadi*\n\n' +
      'Ulangan akkaunt hech qanday guruh yoki kanalga a\'zo emas.\n' +
      'Yoki guruh ID sini qo\'lda kiriting.';
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback('🔄 Yangilash', 'gsy:0')],
      [Markup.button.callback('➕ Guruh ID qo\'shish', 'add_group_manual')],
      [Markup.button.callback('⬅️ Orqaga', 'guruhlar_menu')]
    ]);
    if (edit) return ctx.editMessageText(text, { parse_mode: 'Markdown', ...kb });
    return ctx.reply(text, { parse_mode: 'Markdown', ...kb });
  }

  const totalCount = groups.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  page = Math.min(Math.max(0, page), totalPages - 1);

  const selectedCount = groups.filter(g => g.selected).length;
  const pageItems = groups.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const text =
    `Guruhlarni tanlang (${selectedCount} ta)\n` +
    `Jami: ${totalCount} ta\n` +
    `➕ Tanlanmagan   ✔️ Tanlangan`;

  const rows = [];
  for (let i = 0; i < pageItems.length; i += 2) {
    const row = [buttonFor(pageItems[i], page)];
    if (pageItems[i + 1]) row.push(buttonFor(pageItems[i + 1], page));
    rows.push(row);
  }

  const navRow = [];
  if (page > 0) navRow.push(Markup.button.callback('⬅️ Oldingi', `gpg:${page - 1}`));
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

  if (edit) {
    try {
      return await ctx.editMessageText(text, kb);
    } catch {
      return ctx.reply(text, kb);
    }
  }
  return ctx.reply(text, kb);
}

function buttonFor(g, page) {
  const label = truncate(g.groupName, 24);
  return Markup.button.callback(
    `${g.selected ? '✔️' : '➕'} ${label}`,
    `tgl:${g._id}:${page}`
  );
}

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

// Guruhni tanlash/bekor qilish (bitta guruh)
async function toggleGroupAction(ctx) {
  const [, id, pageStr] = ctx.callbackQuery.data.split(':');
  const group = await Group.findOne({ _id: id, userId: ctx.from.id });
  if (!group) return ctx.answerCbQuery('❌ Guruh topilmadi', { show_alert: true });

  group.selected = !group.selected;
  await group.save();

  await ctx.answerCbQuery(group.selected ? '✅ Tanlandi' : '➕ Bekor qilindi');
  await showGroupList(ctx, parseInt(pageStr, 10) || 0, { edit: true });
}

// Sahifani almashtirish
async function groupPageAction(ctx) {
  await ctx.answerCbQuery();
  const page = parseInt(ctx.callbackQuery.data.split(':')[1], 10) || 0;
  await showGroupList(ctx, page, { edit: true });
}

// Hammasini tanlash (barcha sahifalar bo'yicha)
async function groupSelectAllAction(ctx) {
  const page = parseInt(ctx.callbackQuery.data.split(':')[1], 10) || 0;
  await Group.updateMany({ userId: ctx.from.id }, { selected: true });
  await ctx.answerCbQuery('✅ Barcha guruhlar tanlandi');
  await showGroupList(ctx, page, { edit: true });
}

// Saqlash — tanlovni yakunlash
async function groupSaveAction(ctx) {
  const page = parseInt(ctx.callbackQuery.data.split(':')[1], 10) || 0;
  const selectedCount = await Group.countDocuments({ userId: ctx.from.id, selected: true });
  await User.findOneAndUpdate(
    { userId: ctx.from.id },
    { groupMode: 'selected' },
    { upsert: true }
  );
  await ctx.answerCbQuery(`💾 Saqlandi! ${selectedCount} ta guruh tanlangan`, { show_alert: true });
  await showGroupList(ctx, page, { edit: true });
}

// Qayta yuklash (akkauntdan yangidan sinxronlash)
async function groupSyncAction(ctx) {
  await ctx.answerCbQuery('🔄 Yangilanmoqda...');
  await showGroupList(ctx, 0, { forceSync: true, edit: false });
}

// Guruh qo'shish scene (qo'lda ID kiritish)
const addGroupScene = new Scenes.WizardScene(
  'ADD_GROUP',

  async (ctx) => {
    await ctx.reply(
      '➕ *Guruh ID kiriting:*\n\n' +
      'Guruh ID ni olish uchun:\n' +
      '1. Botni guruhga qo\'shing\n' +
      '2. Guruhda `/id` yozing\n\n' +
      'Yoki guruh username: `@guruhusername`',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('❌ Bekor qilish', 'cancel_add_group')]
        ])
      }
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (ctx.callbackQuery?.data === 'cancel_add_group') {
      await ctx.answerCbQuery();
      await ctx.scene.leave();
      return;
    }

    const input = ctx.message?.text?.trim();
    if (!input) return;

    const groupId = input.startsWith('@') ? input : input;
    const groupName = input.startsWith('@') ? input : `Guruh ${input}`;

    try {
      await Group.findOneAndUpdate(
        { userId: ctx.from.id, groupId },
        { userId: ctx.from.id, groupId, groupName, selected: true },
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

addGroupScene.action('cancel_add_group', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.scene.leave();
});

// Bot guruhga qo'shilganda avtomatik saqlash (zaxira usul)
async function onBotAddedToGroup(ctx) {
  if (!ctx.chat || !['group', 'supergroup'].includes(ctx.chat.type)) return;

  const admins = await ctx.telegram.getChatAdministrators(ctx.chat.id);
  const isAdmin = admins.some(a => a.user.id === ctx.botInfo.id);
  if (!isAdmin) return;

  for (const admin of admins) {
    if (admin.user.is_bot) continue;
    try {
      await Group.findOneAndUpdate(
        { userId: admin.user.id, groupId: String(ctx.chat.id) },
        {
          userId: admin.user.id,
          groupId: String(ctx.chat.id),
          groupName: ctx.chat.title || 'Noma\'lum guruh',
          selected: true
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
