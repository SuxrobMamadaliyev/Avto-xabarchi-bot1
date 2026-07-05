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
    { connectionRetries: 3 }
  );

  const dialogs = [];
  try {
    await client.connect();
    for await (const d of client.iterDialogs()) {
      dialogs.push(d);
    }
  } finally {
    try { await client.disconnect(); } catch {}
  }

  // Guruh va kanallar (shaxsiy chatlar chiqariladi)
  return dialogs
    .filter(d => d.isGroup || d.isChannel || d.isBroadcast)
    .map((d, i) => ({
      groupId:   typeof d.id === 'bigint' ? d.id.toString() : String(d.id),
      groupName: (d.title || d.name || 'Nomsiz guruh').trim(),
      order:     i
    }));
}

// ─── Guruhlarni session cacheda saqlash (pagination uchun) ───────────────────
// Har safar GramJS ga ulanmaslik uchun 5 daqiqalik cache ishlatamiz.
// "Yangilash" tugmasi cache ni tozalab, qayta yuklaydi.
const CACHE_TTL = 5 * 60 * 1000; // 5 daqiqa

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
    return cache.groups; // cache dan
  }

  // GramJS dan yangi olish
  const groups = await fetchLiveGroups(account);

  if (!ctx.session) ctx.session = {};
  ctx.session.groupsCache = { groups, accountId, ts: now };

  return groups;
}

// ─── Asosiy menyu ─────────────────────────────────────────────────────────────
async function guruhlarHandler(ctx) {
  const userId  = ctx.from.id;
  const account = await Account.findOne({ userId, isActive: true });
  const user    = await User.findOne({ userId });
  const mode    = user?.groupMode || 'all';
  const selCount = user?.selectedGroups?.length || 0;

  const text =
    `💬 *Guruhlarni sozlash*\n` +
    `${'━'.repeat(22)}\n\n` +
    `📱 Akkaunt: ${account ? account.phone : '❌ Ulanmagan'}\n` +
    `📋 Rejim: ${mode === 'all' ? '🌐 Hamma guruhlarga' : `☑️ Tanlangan (${selCount} ta)`}`;

  const kb = Markup.inlineKeyboard([
    [
      Markup.button.callback('🌐 Hammaga', 'group_mode_all'),
      Markup.button.callback('☑️ Tanlash', 'group_mode_select')
    ],
    [Markup.button.callback('📋 Guruhlar ro\'yxati', 'gpg:0')],
    [Markup.button.callback('🔄 Yangilash (live)', 'gsy:0')],
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

// ─── Guruhlar ro'yxatini ko'rsatish ──────────────────────────────────────────
async function showGroupList(ctx, page = 0, { forceRefresh = false, edit = false } = {}) {
  const userId  = ctx.from.id;
  const account = await Account.findOne({ userId, isActive: true });

  if (!account) {
    const text = '⚠️ *Avval akkaunt ulang!*';
    const kb   = Markup.inlineKeyboard([
      [Markup.button.callback('➕ Akkaunt qo\'shish', 'add_account')],
      [Markup.button.callback('⬅️ Orqaga', 'guruhlar_menu')]
    ]);
    if (edit) { try { return ctx.editMessageText(text, { parse_mode: 'Markdown', ...kb }); } catch {} }
    return ctx.reply(text, { parse_mode: 'Markdown', ...kb });
  }

  let loadingMsg = null;
  if (forceRefresh && !edit) {
    loadingMsg = await ctx.reply('⏳ Guruhlar yuklanmoqda...');
  }

  let groups;
  try {
    groups = await getGroups(ctx, account, forceRefresh);
  } catch (err) {
    if (loadingMsg) { try { await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id); } catch {} }
    const text = `❌ *Yuklashda xato:*\n\`${err.message}\``;
    const kb   = Markup.inlineKeyboard([
      [Markup.button.callback('🔄 Qayta urinish', 'gsy:0')],
      [Markup.button.callback('⬅️ Orqaga', 'guruhlar_menu')]
    ]);
    if (edit) { try { return ctx.editMessageText(text, { parse_mode: 'Markdown', ...kb }); } catch {} }
    return ctx.reply(text, { parse_mode: 'Markdown', ...kb });
  }

  if (loadingMsg) { try { await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id); } catch {} }

  if (!groups.length) {
    const text = '📋 *Guruh topilmadi*\n\nAkkaunt hech qanday guruhga a\'zo emas.';
    const kb   = Markup.inlineKeyboard([
      [Markup.button.callback('🔄 Yangilash', 'gsy:0')],
      [Markup.button.callback('⬅️ Orqaga', 'guruhlar_menu')]
    ]);
    if (edit) { try { return ctx.editMessageText(text, { parse_mode: 'Markdown', ...kb }); } catch {} }
    return ctx.reply(text, { parse_mode: 'Markdown', ...kb });
  }

  // Tanlangan IDlar
  const user         = await User.findOne({ userId }, 'selectedGroups').lean();
  const selectedSet  = new Set(user?.selectedGroups || []);

  const totalCount  = groups.length;
  const totalPages  = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  page = Math.min(Math.max(0, page), totalPages - 1);

  const selectedCount = groups.filter(g => selectedSet.has(g.groupId)).length;
  const pageItems     = groups.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const cacheAge = ctx.session?.groupsCache?.ts
    ? Math.round((Date.now() - ctx.session.groupsCache.ts) / 1000)
    : 0;

  const text =
    `Guruhlarni tanlang (${selectedCount} ta)\n` +
    `Jami: ${totalCount} ta · ${cacheAge}s oldin yangilandi\n` +
    `➕ Tanlanmagan   ✔️ Tanlangan`;

  const rows = [];
  for (let i = 0; i < pageItems.length; i += 2) {
    const row = [btnFor(pageItems[i], selectedSet, page)];
    if (pageItems[i + 1]) row.push(btnFor(pageItems[i + 1], selectedSet, page));
    rows.push(row);
  }

  const navRow = [];
  if (page > 0)              navRow.push(Markup.button.callback('⬅️ Oldingi', `gpg:${page - 1}`));
  if (page < totalPages - 1) navRow.push(Markup.button.callback('Keyingi ➡️', `gpg:${page + 1}`));
  if (navRow.length) rows.push(navRow);

  rows.push([
    Markup.button.callback('☑️ Hammasini tanlash', `gsa:${page}`),
    Markup.button.callback(`💾 Saqlash (${selectedCount})`, `gsv:${page}`)
  ]);
  rows.push([
    Markup.button.callback('🔄 Yangilash', 'gsy:0'),
    Markup.button.callback('⬅️ Orqaga', 'guruhlar_menu')
  ]);

  const kb = Markup.inlineKeyboard(rows);
  if (edit) { try { return await ctx.editMessageText(text, kb); } catch {} }
  return ctx.reply(text, kb);
}

function btnFor(g, selectedSet, page) {
  const sel = selectedSet.has(g.groupId);
  return Markup.button.callback(
    `${sel ? '✔️' : '➕'} ${truncate(g.groupName, 22)}`,
    `tgl:${g.groupId}:${page}`
  );
}
function truncate(str, max) {
  return str?.length > max ? str.slice(0, max - 1) + '…' : (str || '');
}

// ─── Actions ─────────────────────────────────────────────────────────────────
async function toggleGroupAction(ctx) {
  const parts   = ctx.callbackQuery.data.split(':');
  const groupId = parts[1];
  const page    = parseInt(parts[2], 10) || 0;
  const userId  = ctx.from.id;

  const user = await User.findOne({ userId });
  const arr  = user?.selectedGroups || [];
  const idx  = arr.indexOf(groupId);

  let isSelected;
  if (idx === -1) {
    arr.push(groupId);
    isSelected = true;
  } else {
    arr.splice(idx, 1);
    isSelected = false;
  }

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
  const page    = parseInt(ctx.callbackQuery.data.split(':')[1], 10) || 0;
  const user    = await User.findOne({ userId: ctx.from.id });
  const count   = user?.selectedGroups?.length || 0;
  await User.findOneAndUpdate({ userId: ctx.from.id }, { groupMode: 'selected' }, { upsert: true });
  await ctx.answerCbQuery(`💾 Saqlandi! ${count} ta guruh tanlangan`, { show_alert: true });
  await showGroupList(ctx, page, { edit: true });
}

async function groupSyncAction(ctx) {
  await ctx.answerCbQuery('🔄 Yangilanmoqda...');
  await showGroupList(ctx, 0, { forceRefresh: true, edit: false });
}

// ─── Bot guruhga qo'shilganda (optional, faqat log) ──────────────────────────
async function onBotAddedToGroup(ctx) {
  if (!['group', 'supergroup'].includes(ctx.chat?.type)) return;
  console.log(`[guruhlar] Bot guruhga qo'shildi: ${ctx.chat.title} (${ctx.chat.id})`);
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
  addGroupScene: new (require('telegraf').Scenes.WizardScene)('ADD_GROUP', ctx => ctx.scene.leave()),
  onBotAddedToGroup,
  fetchLiveGroups
};
