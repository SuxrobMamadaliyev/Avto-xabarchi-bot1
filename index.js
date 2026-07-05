require('dotenv').config();
const { Telegraf, Scenes, session, Markup } = require('telegraf');
const mongoose = require('mongoose');

const bot = new Telegraf(process.env.BOT_TOKEN);

// ─── Models ──────────────────────────────────────────────────────────────────
const User    = require('./User');
const Account = require('./Account');

// ─── Handlers ────────────────────────────────────────────────────────────────
const addAccountScene = require('./addAccount');

const { intervalHandler, setIntervalAction, intervalInfoAction, intervalManualScene } = require('./interval');
const { guruhlarHandler, groupModeAllAction, groupModeSelectAction, toggleGroupAction, groupPageAction, groupSelectAllAction, groupSaveAction, groupSyncAction, addGroupScene, onBotAddedToGroup } = require('./guruhlar');
const { habarMatniHandler, msgForwardLockedAction, msgMultiLockedAction, textMsgScene, photoMsgScene, buttonMsgScene } = require('./habarMatni');
const { profillarHandler, profileDetailAction, profileToggleAction, profileDeleteAction } = require('./profillar');

// ─── Sender (Autohabar) ───────────────────────────────────────────────────────
const { startAutoSend, stopAutoSend, isRunning } = require('./sender');

// ─── Stage ───────────────────────────────────────────────────────────────────
const stage = new Scenes.Stage([
  addAccountScene,
  intervalManualScene,
  addGroupScene,
  textMsgScene,
  photoMsgScene,
  buttonMsgScene,
]);
bot.use(session());
bot.use(stage.middleware());

// ─── MongoDB ─────────────────────────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB ulandi'))
  .catch(err => console.error('❌ MongoDB xato:', err));

// ─── MAJBURIY OBUNA ───────────────────────────────────────────────────────────
const CHANNELS = process.env.CHANNELS
  ? process.env.CHANNELS.split(',').map(c => c.trim())
  : [];

async function checkSubscription(ctx) {
  if (!CHANNELS.length) return true;
  for (const channel of CHANNELS) {
    try {
      const member = await ctx.telegram.getChatMember(channel, ctx.from.id);
      if (['left', 'kicked'].includes(member.status)) return false;
    } catch { return false; }
  }
  return true;
}

function subscribeKeyboard() {
  const buttons = CHANNELS.map((ch, i) =>
    [Markup.button.url(`📢 Kanal ${i + 1}`, `https://t.me/${ch.replace('@', '')}`)]);
  buttons.push([Markup.button.callback('✅ Obuna bo\'ldim', 'check_sub')]);
  return Markup.inlineKeyboard(buttons);
}

// ─── ASOSIY MENYU ─────────────────────────────────────────────────────────────
function mainMenuKeyboard() {
  return Markup.keyboard([
    ['🚀 Autohabar yuborish', '✏️ Habar matni'],
    ['⏱ Interval',           '💬 Guruhlarni sozlash'],
    ['👤 Profillar',          '👑 Pro tarif'],
    ['🗂 Kabinet',            '⚙️ Sozlamalar'],
    ['📅 Kalendar',           '🔧 Foydali funksiyalar'],
    ['📊 Statistika',         '🙋 Yordam'],
    ['📖 Qo\'llanma',         '↩️ Autoreply'],
  ]).resize();
}

function escapeMdV2(text) {
  return String(text ?? '').replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}
function escapeMdV2Code(text) {
  return String(text ?? '').replace(/[`\\]/g, '\\$&');
}

// ─── BOSH SAHIFA ──────────────────────────────────────────────────────────────
async function showMainMenu(ctx) {
  const acc = await Account.findOne({ userId: ctx.from.id, isActive: true });

  if (!acc) {
    const safeName = escapeMdV2(ctx.from.first_name);
    const menuText =
      `◇ *AUTO HABAR PRO*\n` +
      `${'─'.repeat(30)}\n\n` +
      `Salom, ${safeName} 👋\n\n` +
      `>› Akkaunt qo'shing\n` +
      `>› Guruhlarni sozlang\n` +
      `>› Habarni sozlang\n` +
      `>› Autohabarni ishga tushuring`;

    return ctx.reply(menuText, {
      parse_mode: 'MarkdownV2',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('➕ Akkaunt qo\'shish', 'add_account')]
      ])
    });
  }

  const user = await User.findOne({ userId: ctx.from.id });
  const interval = user?.interval || 300;
  const tarif    = user?.tarif === 'pro' ? 'Pro' : 'Bepul';
  const running  = user?.isRunning || isRunning(ctx.from.id);

  const panelText =
    `⚙️ *Boshqaruv Paneli*\n` +
    `${'━'.repeat(20)}\n\n` +
    `📱 Ulangan: \`${escapeMdV2Code(acc.phone)}\`\n\n` +
    `🚀 Auto Habar: ${running ? '🟢 Yoqiq' : '🔴 O\'chiq'}\n` +
    `💎 Tarifingiz: 🔘 ${escapeMdV2(tarif)}\n` +
    `⏱ Interval: ${interval} soniya\n` +
    `${'━'.repeat(20)}\n\n` +
    `👇 Kerakli tugmani pastdan tanlang:`;

  return ctx.reply(panelText, { parse_mode: 'MarkdownV2' });
}

// ─── /start ───────────────────────────────────────────────────────────────────
bot.start(async (ctx) => {
  if (!['private'].includes(ctx.chat.type)) return;

  await User.findOneAndUpdate(
    { userId: ctx.from.id },
    { userId: ctx.from.id, username: ctx.from.username, firstName: ctx.from.first_name, lastSeen: new Date() },
    { upsert: true }
  );

  const subscribed = await checkSubscription(ctx);
  if (!subscribed) {
    return ctx.reply('📢 *Botdan foydalanish uchun obuna bo\'ling:*', {
      parse_mode: 'Markdown',
      ...subscribeKeyboard()
    });
  }

  await ctx.reply('✅ Obuna tasdiqlandi!');
  await ctx.reply('📊 *Asosiy menyu:*', { parse_mode: 'Markdown', ...mainMenuKeyboard() });
  await showMainMenu(ctx);
});

// Obuna tekshirish
bot.action('check_sub', async (ctx) => {
  await ctx.answerCbQuery();
  const subscribed = await checkSubscription(ctx);
  if (!subscribed) {
    return ctx.answerCbQuery('❌ Hali obuna bo\'lmagansiz!', { show_alert: true });
  }
  try { await ctx.deleteMessage(); } catch {}
  await ctx.reply('✅ Obuna tasdiqlandi!');
  await ctx.reply('📊 *Asosiy menyu:*', { parse_mode: 'Markdown', ...mainMenuKeyboard() });
  await showMainMenu(ctx);
});

// ─── INLINE ACTIONS ───────────────────────────────────────────────────────────
bot.action('add_account',    (ctx) => { ctx.answerCbQuery(); ctx.scene.enter('ADD_ACCOUNT'); });
bot.action('main_menu',      async (ctx) => { ctx.answerCbQuery(); await showMainMenu(ctx); });
bot.action('profillar_menu', async (ctx) => { ctx.answerCbQuery(); await profillarHandler(ctx); });
bot.action('guruhlar_menu',  async (ctx) => { ctx.answerCbQuery(); await guruhlarHandler(ctx); });

// ─── AUTOHABAR YOQISH/O'CHIRISH (inline) ────────────────────────────────────
bot.action('autohabar_start', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  await startAutoSend(userId, bot);
  await ctx.editMessageText(
    '🟢 *Autohabar yoqildi!*\n\nBot guruhlaringizga xabar yuborishni boshladi.',
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔴 To\'xtatish', 'autohabar_stop')],
        [Markup.button.callback('⬅️ Orqaga', 'main_menu')]
      ])
    }
  );
});

bot.action('autohabar_stop', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  await stopAutoSend(userId);
  await ctx.editMessageText(
    '🔴 *Autohabar to\'xtatildi.*\n\nYuborish to\'xtatildi.',
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🟢 Yoqish', 'autohabar_start')],
        [Markup.button.callback('⬅️ Orqaga', 'main_menu')]
      ])
    }
  );
});

// Interval actions
bot.action('interval_info',   intervalInfoAction);
bot.action('interval_manual', (ctx) => { ctx.answerCbQuery(); ctx.scene.enter('INTERVAL_MANUAL'); });
bot.action(/^set_interval_/,  setIntervalAction);

// Guruh actions
bot.action('group_mode_all',    groupModeAllAction);
bot.action('group_mode_select', groupModeSelectAction);
bot.action(/^tgl:/,             toggleGroupAction);
bot.action(/^gpg:/,             groupPageAction);
bot.action(/^gsa:/,             groupSelectAllAction);
bot.action(/^gsv:/,             groupSaveAction);
bot.action(/^gsy:/,             groupSyncAction);
bot.action('add_group_manual',  (ctx) => { ctx.answerCbQuery(); ctx.scene.enter('ADD_GROUP'); });

// Habar matni actions
bot.action('msg_type_text',           (ctx) => { ctx.answerCbQuery(); ctx.scene.enter('TEXT_MSG'); });
bot.action('msg_type_photo',          (ctx) => { ctx.answerCbQuery(); ctx.scene.enter('PHOTO_MSG'); });
bot.action('msg_type_button',         (ctx) => { ctx.answerCbQuery(); ctx.scene.enter('BUTTON_MSG'); });
bot.action('msg_type_forward_locked', msgForwardLockedAction);
bot.action('msg_type_multi_locked',   msgMultiLockedAction);

// Profil actions
bot.action(/^profile_detail_/, profileDetailAction);
bot.action(/^profile_toggle_/, profileToggleAction);
bot.action(/^profile_delete_/, profileDeleteAction);

// ─── KEYBOARD HEARS ───────────────────────────────────────────────────────────

// 🚀 AUTOHABAR — to'liq implement qilindi
bot.hears('🚀 Autohabar yuborish', async (ctx) => {
  const userId = ctx.from.id;

  const acc = await Account.findOne({ userId, isActive: true });
  if (!acc) {
    return ctx.reply('⚠️ Avval akkaunt qo\'shing!',
      Markup.inlineKeyboard([[Markup.button.callback('➕ Akkaunt qo\'shish', 'add_account')]])
    );
  }

  const { MsgSettings } = require('./habarMatni');
  const { Group }       = require('./guruhlar');

  const [user, msg, groupCount] = await Promise.all([
    User.findOne({ userId }),
    MsgSettings.findOne({ userId }),
    Group.countDocuments({ userId })
  ]);

  const running     = user?.isRunning || isRunning(userId);
  const groupMode   = user?.groupMode || 'all';
  const interval    = user?.interval  || 300;
  const selectedCount = await Group.countDocuments({ userId, selected: true });

  const statusText =
    `🚀 *Autohabar yuborish*\n` +
    `${'━'.repeat(22)}\n\n` +
    `📋 Holat: ${running ? '🟢 Yoqiq' : '🔴 O\'chiq'}\n` +
    `💬 Guruhlar: ${groupMode === 'all' ? `Hammasi (${groupCount} ta)` : `Tanlangan (${selectedCount} ta)`}\n` +
    `⏱ Interval: ${interval >= 3600 ? `${interval/3600} soat` : `${interval/60} daqiqa`}\n` +
    `📝 Habar: ${msg?.text ? `"${msg.text.slice(0, 25)}..."` : '❌ Sozlanmagan'}\n\n` +
    (running
      ? '✅ Autohabar hozir ishlaydi. To\'xtatish uchun tugmani bosing.'
      : '▶️ Boshlash uchun "Yoqish" tugmasini bosing.');

  const kb = running
    ? Markup.inlineKeyboard([
        [Markup.button.callback('🔴 To\'xtatish', 'autohabar_stop')],
        [Markup.button.callback('⬅️ Orqaga', 'main_menu')]
      ])
    : Markup.inlineKeyboard([
        [Markup.button.callback('🟢 Yoqish', 'autohabar_start')],
        [Markup.button.callback('⬅️ Orqaga', 'main_menu')]
      ]);

  await ctx.reply(statusText, { parse_mode: 'Markdown', ...kb });
});

bot.hears('✏️ Habar matni',        habarMatniHandler);
bot.hears('⏱ Interval',            intervalHandler);
bot.hears('💬 Guruhlarni sozlash', guruhlarHandler);
bot.hears('👤 Profillar',          profillarHandler);

bot.hears('👑 Pro tarif', (ctx) =>
  ctx.reply(
    '👑 *Pro Tarif*\n\n✅ Cheksiz guruhlar\n✅ Tez interval\n✅ Ko\'p akkaunt\n✅ Forward\n\n💰 Narx: So\'rov asosida',
    { parse_mode: 'Markdown' }
  )
);

bot.hears('🗂 Kabinet', async (ctx) => {
  const count = await Account.countDocuments({ userId: ctx.from.id });
  await ctx.reply(
    `🗂 *Kabinet*\n\n👤 Ism: ${ctx.from.first_name}\n🆔 ID: \`${ctx.from.id}\`\n📱 Akkauntlar: ${count} ta\n⭐ Tarif: Bepul`,
    { parse_mode: 'Markdown' }
  );
});

bot.hears('⚙️ Sozlamalar',         (ctx) => ctx.reply('⚙️ Sozlamalar (tez kunda)...'));
bot.hears('📅 Kalendar',           (ctx) => ctx.reply('📅 Kalendar (tez kunda)...'));
bot.hears('🔧 Foydali funksiyalar',(ctx) => ctx.reply('🔧 Foydali funksiyalar (tez kunda)...'));
bot.hears('📊 Statistika',         (ctx) => ctx.reply('📊 Statistika (tez kunda)...'));

bot.hears('🙋 Yordam', (ctx) =>
  ctx.reply(
    '🙋 *Yordam*\n\n1. Akkaunt qo\'shing\n2. Guruhlarni tanlang\n3. Habar matnini yozing\n4. Intervalni sozlang\n5. Autohabarni yoqing\n\n📞 Admin: @admin',
    { parse_mode: 'Markdown' }
  )
);

bot.hears('📖 Qo\'llanma', (ctx) => ctx.reply('📖 Qo\'llanma (tez kunda)...'));
bot.hears('↩️ Autoreply',  (ctx) => ctx.reply('↩️ Autoreply (tez kunda)...'));

// ─── GURUH /id BUYRUG'I ───────────────────────────────────────────────────────
bot.command('id', async (ctx) => {
  await ctx.reply(`🆔 Chat ID: \`${ctx.chat.id}\``, { parse_mode: 'Markdown' });
});

// ─── BOT GURUHGA QO'SHILGANDA ─────────────────────────────────────────────────
bot.on('my_chat_member', onBotAddedToGroup);

// ─── LAUNCH ───────────────────────────────────────────────────────────────────
if (process.env.WEBHOOK_URL) {
  bot.launch({ webhook: { domain: process.env.WEBHOOK_URL, port: process.env.PORT || 3000 } });
} else {
  bot.launch();
}

console.log('🤖 Bot ishga tushdi...');
process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
