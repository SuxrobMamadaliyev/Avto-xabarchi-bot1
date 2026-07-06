const { Scenes } = require('telegraf');
const { TelegramClient } = require('telegram');
const { StringSession }  = require('telegram/sessions');
const { iBtn, rawInline } = require('./styledKb');

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
    dialogs = await client.getDialogs({ limit: 500, archived: false });
  } finally {
    try { await client.disconnect(); } catch {}
  }

  console.log(`[guruhlar] Jami dialoglar: ${dialogs.length} ta`);

  const groups = [];
  for (let i = 0; i < dialogs.length; i++) {
    const d      = dialogs[i];
    const entity = d.entity;

    // entity kelmagan bo'lsa ham, peer'dan className olishga urinamiz
    const cn = entity?.className || d.dialog?.peer?.className || '';

    console.log(`[guruhlar] #${i}: className=${cn} isGroup=${d.isGroup} isChannel=${d.isChannel} title="${entity?.title || d.title || ''}"`);

    // Faqat guruhlar: oddiy Chat, ChatForbidden yoki megagroup (super)Channel.
    // Broadcast kanallar (megagroup=false) va shaxsiy chatlar (User) chiqarib tashlanadi.
    if (cn === 'User') continue;
    if (!cn) continue; // aniqlab bo'lmagan holatlarni tashlab ketamiz

    const isPlainGroup   = cn === 'Chat' || cn === 'ChatForbidden';
    const isSupergroup   = (cn === 'Channel' || cn === 'ChannelForbidden') &&
                            Boolean(entity?.megagroup);

    if (!isPlainGroup && !isSupergroup) {
      console.log(`[guruhlar] #${i}: kanal bo'lgani uchun o'tkazib yuborildi (className=${cn}, megagroup=${entity?.megagroup})`);
      continue;
    }

    const id =
      typeof d.id === 'bigint' ? d.id.toString() :
      d.id != null ? String(d.id) :
      entity?.id != null ? String(entity.id) : null;

    if (!id) {
      console.log(`[guruhlar] #${i}: ID topilmadi, o'tkazib yuborildi (className=${cn})`);
      continue;
    }

    groups.push({
      groupId:   id,
      groupName: (entity?.title || d.title || d.name || 'Nomsiz guruh').trim(),
      order:     i
    });
  }

  console.log(`[guruhlar] Filtrlangan guruhlar: ${groups.length} ta`);
  return groups;
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

// ─── Guruhlarni sozlash ───────────────────────────────────────────────────────
async function guruhlarHandler(ctx) {
  try {
    const userId = ctx.from.id;
    if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});

    const account = await Account.findOne({ userId, isActive: true });
    if (!account) {
      const text = '⚠️ *Avval akkaunt ulang!*';
      const kb   = rawInline([[iBtn('➕ Akkaunt qo\'shish', 'add_account', 'success')]]);
      return ctx.callbackQuery
        ? ctx.editMessageText(text, { parse_mode: 'Markdown', ...kb }).catch(() => ctx.reply(text, { parse_mode: 'Markdown', ...kb }))
        : ctx.reply(text, { parse_mode: 'Markdown', ...kb });
    }

    const sent = await ctx.reply('⏳ Guruhlar yuklanmoqda...');

    let groups = [];
    let errText = null;
    try {
      groups = await getGroups(ctx, account, false);
    } catch (err) {
      errText = err.message;
    }

    await ctx.telegram.deleteMessage(ctx.chat.id, sent.message_id).catch(() => {});

    if (errText) {
      return ctx.reply(
        `❌ *Guruhlarni yuklashda xato:*\n\`${errText}\``,
        {
          parse_mode: 'Markdown',
          ...rawInline([
            [iBtn('🔄 Qayta urinish', 'guruhlar_menu', 'primary')],
            [iBtn('⬅️ Orqaga',       'main_menu')]
          ])
        }
      );
    }

    await showGroupList(ctx, 0, { groups, edit: false });
  } catch (err) {
    console.error('[guruhlar] guruhlarHandler xato:', err);
    ctx.reply(`❌ Debug xato:\n<code>${err.message}</code>`, { parse_mode: 'HTML' }).catch(() => {});
  }
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
    iBtn(
      mode === 'selected' ? '☑️ Tanlash ✓' : '☑️ Tanlash',
      'group_mode_select',
      mode === 'selected' ? 'success' : 'primary'
    )
  ]);

  // Guruh tugmalari
  for (let i = 0; i < pageItems.length; i += 2) {
    const row = [btnFor(pageItems[i], selectedSet, page)];
    if (pageItems[i + 1]) row.push(btnFor(pageItems[i + 1], selectedSet, page));
    rows.push(row);
  }

  // Navigatsiya (sahifalar)
  if (totalPages > 1) {
    const navRow = [];
    if (page > 0)              navRow.push(iBtn('◀️', `gpg:${page - 1}`, 'primary'));
    if (page < totalPages - 1) navRow.push(iBtn('▶️', `gpg:${page + 1}`, 'primary'));
    if (navRow.length) rows.push(navRow);
  }

  // Pastki tugmalar
  rows.push([
    iBtn('☑️ Hammasini tanlash', `gsa:${page}`, 'primary'),
    iBtn(`💾 Saqlash (${selCount})`, `gsv:${page}`, 'success')
  ]);
  rows.push([iBtn('⬅️ Orqaga', 'main_menu')]);

  const kb = rawInline(rows);

  if (edit) {
    try { return await ctx.editMessageText(header, { parse_mode: 'Markdown', ...kb }); } catch {}
  }
  return ctx.reply(header, { parse_mode: 'Markdown', ...kb });
}

function btnFor(g, selectedSet, page) {
  const selected = selectedSet.has(g.groupId);
  return iBtn(
    `${selected ? '✔️' : '➕'} ${trunc(g.groupName, 22)}`,
    `tgl:${g.groupId}:${page}`,
    selected ? 'success' : undefined
  );
}

function trunc(s, n) {
  if (!s) return '';
  const chars = Array.from(s);
  if (chars.length <= n) return sanitize(s);
  return sanitize(chars.slice(0, n - 1).join('')) + '…';
}

function sanitize(str) {
  return String(str)
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
    .replace(/(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/g, m => m.length > 1 ? m : '')
    .trim() || 'Nomsiz guruh';
}

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

async function onBotAddedToGroup(ctx) {
  if (!['group', 'supergroup'].includes(ctx.chat?.type)) return;
  if (ctx.myChatMember?.new_chat_member?.status !== 'member' &&
      ctx.myChatMember?.new_chat_member?.status !== 'administrator') return;

  const chatTitle = ctx.chat.title || 'Noma\'lum';
  const chatId    = String(ctx.chat.id);

  try {
    const admins = await ctx.telegram.getChatAdministrators(ctx.chat.id);
    for (const adm of admins) {
      if (adm.user.is_bot) continue;
      const acc = await Account.findOne({ userId: adm.user.id, isActive: true });
      if (!acc) continue;

      console.log(`[guruhlar] Yangi guruh: ${chatTitle} (${chatId}) — userId:${adm.user.id}`);

      await ctx.telegram.sendMessage(
        adm.user.id,
        `✅ *Yangi guruh qo'shildi!*\n\n💬 ${chatTitle}\n🆔 \`${chatId}\`\n\n📋 Guruhlar ro'yxatini ko'rish uchun "Guruhlarni sozlash" ni oching.`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    }
  } catch {}
}

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
