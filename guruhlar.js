const { Markup } = require('telegraf');
const { Scenes } = require('telegraf');
const { TelegramClient } = require('telegram');
const { StringSession }  = require('telegram/sessions');

const Account = require('./Account');
const User    = require('./User');

const PAGE_SIZE = 20;

// ─── GramJS dan LIVE guruhlarni olish ────────────────────────────────────────
async function fetchLiveGroups(account) {
  const client = new TelegramClient(
    new StringSession(account.session),
    account.apiId,
    account.apiHash,
    { connectionRetries: 2 }
  );

  let dialogs = [];
  try {
    await client.connect();
    // getDialogs bir so'rovda keladi — iterDialogs dan 10-20x tez
    dialogs = await client.getDialogs({ limit: 200 });
  } finally {
    try { await client.disconnect(); } catch {}
  }

  return dialogs
    .filter(d => d.isGroup || d.isChannel || d.isBroadcast)
    .map((d, i) => ({
      groupId:   typeof d.id === 'bigint' ? d.id.toString() : String(d.id),
      groupName: (d.title || d.name || 'Nomsiz guruh').trim(),
      order:     i
    }));
}

// ─── Cache (session da, 2 daqiqa) ────────────────────────────────────────────
const CACHE_TTL = 2 * 60 * 1000;

async function getGroups(ctx, account, forceRefresh = false) {
  const accountId = account._id.toString();
  const cache     = ctx.session?.groupsCache;
  const now       = Date.now();

  if (
    !forceRefresh &&
    cache?.accountId === accountId &&
    (now - cache.ts) < CACHE_TTL &&
    cache.groups?.length > 0
  ) {
    return cache.groups;
  }

  const groups = await fetchLiveGroups(account);
  if (!ctx.session) ctx.session = {};
  ctx.session.groupsCache = { groups, accountId, ts: now };
  return groups;
}

// ─── Guruhlarni sozlash — ochilganda darhol yuklanadi ────────────────────────
async function guruhlarHandler(ctx) {
  const userId  = ctx.from.id;

  if (ctx.callbackQuery) await ctx.answerCbQuery();

  const account = await Account.findOne({ userId, isActive: true });
  if (!account) {
    return ctx.reply(
      '⚠️ *Avval akkaunt ulang!*',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('➕ Akkaunt qo\'shish', 'add_account')]
        ])
      }
    );
  }

  // Loading xabari
  const loadingMsg = ctx.callbackQuery
    ? null
    : await ctx.reply('⏳ Guruhlar yuklanmoqda...');

  let groups;
  try {
    groups = await getGroups(ctx, account, false);
  } catch (err) {
    if (loadingMsg) { try { await ctx.deleteMessage(loadingMsg.message_id); } catch {} }
    return ctx.reply(`❌ *Xato:* \`${err.message}\``, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('🔄 Qayta', 'guruhlar_menu')]])
    });
  }

  if (loadingMsg) { try { await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id); } catch {} }

  await showGroupList(ctx, 0, { groups, forceRefresh: false, edit: !!ctx.callbackQuery });
}

async function groupModeAllAction(ctx) {
  await ctx.answerCbQuery();
  await User.findOneAndUpdate({ userId: ctx.from.id }, { groupMode: 'all' }, { upsert: true });
  await guruhlarHandler(ctx);
}

async function groupModeSelectAction(ctx) {
  await ctx.answerCbQuery();
  await User.findOneAndUpdate({ userId: ctx.from.id }, { groupMode: 'selected' }, { upsert: true });
  await guruhlarHandler(ctx);
}

// ─── Guruhlar ro'yxati ────────────────────────────────────────────────────────
async function showGroupList(ctx, page = 0, { groups = null, forceRefresh = false, edit = false } = {}) {
  const userId  = ctx.from.id;
  const account = await Account.findOne({ userId, isActive: true });
  if (!account) return;

  if (!groups) {
    if (forceRefresh) {
      const m = edit ? null : await ctx.reply('⏳ Yangilanmoqda...');
      try {
        groups = await getGroups(ctx, account, true);
      } catch (err) {
        if (m) { try { await ctx.telegram.deleteMessage(ctx.chat.id, m.message_id); } catch {} }
        return ctx.reply(`❌ \`${err.message}\``, { parse_mode: 'Markdown' });
      }
      if (m) { try { await ctx.telegram.deleteMessage(ctx.chat.id, m.message_id); } catch {} }
      page = 0; edit = false;
    } else {
      groups = await getGroups(ctx, account, false);
    }
  }

  const user        = await User.findOne({ userId }, 'selectedGroups groupMode').lean();
  const mode        = user?.groupMode || 'all';
  const selectedSet = new Set(user?.selectedGroups || []);

  const total       = groups.length;
  const totalPages  = Math.max(1, Math.ceil(total / PAGE_SIZE));
  page = Math.min(Math.max(0, page), totalPages - 1);

  const selCount  = groups.filter(g => selectedSet.has(g.groupId)).length;
  const pageItems = groups.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const header =
    `📱 *${account.phone}*\n` +
    `💬 Guruhlar: ${total} ta   ✅ Tanlangan: ${selCount} ta\n` +
    `📋 Rejim: ${mode === 'all' ? '🌐 Hammaga' : '☑️ Tanlangan'}\n` +
    (totalPages > 1 ? `📄 Sahifa: ${page + 1}/${totalPages}\n` : '') +
    `\n➕ Tanlanmagan   ✔️ Tanlangan`;

  const rows = [];

  // Tanlash rejimi tugmasi
  rows.push([
    Markup.button.callback(mode === 'selected' ? '☑️ Tanlash ✓' : '☑️ Tanlash', 'group_mode_select')
  ]);

  // Guruh tugmalari
  for (let i = 0; i < pageItems.length; i += 2) {
    const row = [btnFor(pageItems[i], selectedSet, page)];
    if (pageItems[i + 1]) row.push(btnFor(pageItems[i + 1], selectedSet, page));
    rows.push(row);
  }

  // Quyi tugmalar
  rows.push([
    Markup.button.callback('☑️ Hammasini tanlash', `gsa:${page}`),
    Markup.button.callback(`💾 Saqlash (${selCount})`, `gsv:${page}`)
  ]);
  rows.push([Markup.button.callback('⬅️ Orqaga', 'main_menu')]);

  const kb = Markup.inlineKeyboard(rows);

  if (edit) {
    try { return await ctx.editMessageText(header, { parse_mode: 'Markdown', ...kb }); } catch {}
  }
  return ctx.reply(header, { parse_mode: 'Markdown', ...kb });
}

function btnFor(g, selectedSet, page) {
  return Markup.button.callback(
    `${selectedSet.has(g.groupId) ? '✔️' : '➕'} ${trunc(g.groupName, 22)}`,
    `tgl:${g.groupId}:${page}`
  );
}
function trunc(s, n) { return s?.length > n ? s.slice(0, n - 1) + '…' : (s || ''); }

// ─── Actions ─────────────────────────────────────────────────────────────────
async function toggleGroupAction(ctx) {
  const [, groupId, pageStr] = ctx.callbackQuery.data.split(':');
  const userId = ctx.from.id;
  const page   = parseInt(pageStr, 10) || 0;

  const user = await User.findOne({ userId });
  const arr  = [...(user?.selectedGroups || [])];
  const idx  = arr.indexOf(groupId);

  let isSelected;
  if (idx === -1) { arr.push(groupId); isSelected = true; }
  else            { arr.splice(idx, 1); isSelected = false; }

  await User.findOneAndUpdate({ userId }, { selectedGroups: arr }, { upsert: true });
  await ctx.answerCbQuery(isSelected ? '✅ Tanlandi' : '➕ Bekor qilindi');
  await showGroupList(ctx, page, { edit: true });
}

async function groupPageAction(ctx) {
  await ctx.answerCbQuery();
  const page = parseInt(ctx.callbackQuery.data.split(':')[1], 10) || 0;
  await showGroupList(ctx, page, { edit: true });
}

async function groupSelectAllAction(ctx) {
  const page    = parseInt(ctx.callbackQuery.data.split(':')[1], 10) || 0;
  const userId  = ctx.from.id;
  const account = await Account.findOne({ userId, isActive: true });
  if (!account) return ctx.answerCbQuery('❌ Akkaunt topilmadi', { show_alert: true });

  const groups = await getGroups(ctx, account, false);
  const allIds = groups.map(g => g.groupId);
  await User.findOneAndUpdate({ userId }, { selectedGroups: allIds }, { upsert: true });
  await ctx.answerCbQuery(`✅ ${allIds.length} ta guruh tanlandi`);
  await showGroupList(ctx, page, { edit: true });
}

async function groupSaveAction(ctx) {
  const page  = parseInt(ctx.callbackQuery.data.split(':')[1], 10) || 0;
  const user  = await User.findOne({ userId: ctx.from.id }, 'selectedGroups').lean();
  const count = user?.selectedGroups?.length || 0;
  await User.findOneAndUpdate({ userId: ctx.from.id }, { groupMode: 'selected' }, { upsert: true });
  await ctx.answerCbQuery(`💾 Saqlandi! ${count} ta guruh`, { show_alert: true });
  await showGroupList(ctx, page, { edit: true });
}

async function groupSyncAction(ctx) {
  await ctx.answerCbQuery('🔄 Yangilanmoqda...');
  await showGroupList(ctx, 0, { forceRefresh: true, edit: true });
}

// ─── Foydalanuvchi yangi guruhga qo'shilganda (gramjs account) ───────────────
// Bot guruhga qo'shilsa — foydalanuvchiga xabar, cache tozalanadi
async function onBotAddedToGroup(ctx) {
  if (!['group', 'supergroup'].includes(ctx.chat?.type)) return;
  if (ctx.myChatMember?.new_chat_member?.status !== 'member' &&
      ctx.myChatMember?.new_chat_member?.status !== 'administrator') return;

  const chatTitle = ctx.chat.title || 'Noma\'lum';
  const chatId    = String(ctx.chat.id);

  // Admin bo'lgan foydalanuvchilarga xabar yuboramiz
  try {
    const admins = await ctx.telegram.getChatAdministrators(ctx.chat.id);
    for (const adm of admins) {
      if (adm.user.is_bot) continue;
      const acc = await Account.findOne({ userId: adm.user.id, isActive: true });
      if (!acc) continue;

      // Cache ni tozalaymiz — keyingi ochilganda yangi guruh ham ko'rinadi
      // (session bazali, shuning uchun faqat log qilamiz)
      console.log(`[guruhlar] Yangi guruh: ${chatTitle} (${chatId}) — userId:${adm.user.id}`);

      await ctx.telegram.sendMessage(
        adm.user.id,
        `✅ *Yangi guruh qo'shildi!*\n\n💬 ${chatTitle}\n🆔 \`${chatId}\`\n\n📋 Guruhlar ro'yxatini ko'rish uchun "Guruhlarni sozlash" ni oching.`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    }
  } catch {}
}

// Dummy scene (add_group_manual olib tashlandi)
const addGroupScene = new Scenes.WizardScene('ADD_GROUP', ctx => ctx.scene.leave());

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
  fetchLiveGroups
};
