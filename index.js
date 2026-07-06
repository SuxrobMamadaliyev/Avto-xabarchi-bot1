require('dotenv').config();
const { Telegraf, Scenes, session, Markup } = require('telegraf');
const mongoose = require('mongoose');

const bot = new Telegraf(process.env.BOT_TOKEN);

// ─── Models ──────────────────────────────────────────────────────────────────
const User    = require('./User');
const Account = require('./Account');

// ─── Handlers ────────────────────────────────────────────────────────────────
const addAccountScene = require('./addAccount');
const { getEffectiveTarif } = require('./addAccount');

// ─── Referral +1, va 15 taga yetganda avto 7 kunlik Pro ──────────────────────
async function grantReferral(referrerId, ctx) {
  const REF_GOAL = 15;
  const updated = await User.findOneAndUpdate(
    { userId: referrerId },
    { $inc: { referralCount: 1 } },
    { new: true }
  );
  if (!updated) return;

  try {
    await ctx.telegram.sendMessage(
      referrerId,
      `🎉 Sizning havolangiz orqali yangi foydalanuvchi qo'shildi! (${updated.referralCount}/${REF_GOAL})`
    );
  } catch {}

  if (updated.referralCount >= REF_GOAL) {
    const now  = new Date();
    const base = (updated.proExpiresAt && updated.proExpiresAt > now) ? updated.proExpiresAt : now;
    const newExpiry = new Date(base.getTime() + 7 * 24 * 60 * 60 * 1000);

    await User.findOneAndUpdate(
      { userId: referrerId },
      { tarif: 'pro', proExpiresAt: newExpiry, referralCount: 0 } // hisoblagich qayta boshlanadi
    );

    try {
      await ctx.telegram.sendMessage(
        referrerId,
        `🎁 *Tabriklaymiz!* 15 ta do'stingiz obuna bo'ldi!\n\n💎 Sizga *bepul 7 kunlik Pro tarif* berildi!\n📅 Muddat: ${newExpiry.toLocaleDateString('uz-UZ')} gacha`,
        { parse_mode: 'Markdown' }
      );
    } catch {}
  }
}


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

// ─── CRON: Pro muddati tugaganlarni Free ga tushirish ────────────────────────
async function checkExpiredProUsers() {
  try {
    const now = new Date();
    const expired = await User.find({ tarif: 'pro', proExpiresAt: { $lt: now } });

    for (const user of expired) {
      await User.findOneAndUpdate({ userId: user.userId }, { tarif: 'free' });
      console.log(`[cron] userId:${user.userId} Pro muddati tugadi → Free`);
      try {
        await bot.telegram.sendMessage(
          user.userId,
          '⏰ *Pro tarif muddati tugadi!*\n\nSiz Free tarifga o\'tkazildingiz.\nDavom etish uchun qayta faollashtiring: 👑 Pro tarif',
          { parse_mode: 'Markdown' }
        );
      } catch {}
    }

    if (expired.length) console.log(`[cron] ${expired.length} ta foydalanuvchi Free ga tushirildi`);
  } catch (err) {
    console.error('[cron] xato:', err.message);
  }
}
// Har soatda tekshiradi
setInterval(checkExpiredProUsers, 60 * 60 * 1000);
// Bot ishga tushganda ham darhol bir marta tekshiradi
setTimeout(checkExpiredProUsers, 10 * 1000);

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

  const userId    = ctx.from.id;
  const isNewUser = !(await User.findOne({ userId }));

  await User.findOneAndUpdate(
    { userId },
    { userId, username: ctx.from.username, firstName: ctx.from.first_name, lastSeen: new Date() },
    { upsert: true }
  );

  // ─── Referral: /start ref_<referrerId>_<...> ───────────────────────────────
  const payload = ctx.startPayload; // masalan "ref_123456789_0"
  if (isNewUser && payload?.startsWith('ref_')) {
    const referrerId = parseInt(payload.split('_')[1], 10);
    if (referrerId && referrerId !== userId) {
      const already = await User.findOne({ userId });
      if (!already?.referredBy) {
        await User.findOneAndUpdate({ userId }, { referredBy: referrerId });
        // Referral hisoblanishi uchun taklif qilingan foydalanuvchi obunani tasdiqlashi kerak —
        // shuning uchun hozircha faqat referredBy saqlanadi, checkSubscription dan keyin +1 qilinadi
        ctx.session = ctx.session || {};
        ctx.session.pendingReferral = referrerId;
      }
    }
  }

  const subscribed = await checkSubscription(ctx);
  if (!subscribed) {
    return ctx.reply('📢 *Botdan foydalanish uchun obuna bo\'ling:*', {
      parse_mode: 'Markdown',
      ...subscribeKeyboard()
    });
  }

  // Obuna tasdiqlangan va referral kutilayotgan bo'lsa — referrerga +1 qo'shamiz
  const user = await User.findOne({ userId });
  if (user?.referredBy && !user.referralCounted) {
    await grantReferral(user.referredBy, ctx);
    await User.findOneAndUpdate({ userId }, { referralCounted: true });
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

  // Referral: obuna endi tasdiqlandi — kutilayotgan referralni hisoblaymiz
  const user = await User.findOne({ userId: ctx.from.id });
  if (user?.referredBy && !user.referralCounted) {
    await grantReferral(user.referredBy, ctx);
    await User.findOneAndUpdate({ userId: ctx.from.id }, { referralCounted: true });
  }

  await ctx.reply('✅ Obuna tasdiqlandi!');
  await ctx.reply('📊 *Asosiy menyu:*', { parse_mode: 'Markdown', ...mainMenuKeyboard() });
  await showMainMenu(ctx);
});

// ─── INLINE ACTIONS ───────────────────────────────────────────────────────────
bot.action('add_account',    (ctx) => { ctx.answerCbQuery(); ctx.scene.enter('ADD_ACCOUNT'); });
bot.action('main_menu',      async (ctx) => { ctx.answerCbQuery(); await showMainMenu(ctx); });
bot.action('profillar_menu', async (ctx) => { ctx.answerCbQuery(); await profillarHandler(ctx); });
bot.action('guruhlar_menu',  async (ctx) => { ctx.answerCbQuery(); await guruhlarHandler(ctx); });

// ─── AUTOHABAR — Boshqaruv paneli ───────────────────────────────────────────

async function buildControlPanel(ctx) {
  const userId = ctx.from.id;
  const acc    = await Account.findOne({ userId, isActive: true });
  const user   = await User.findOne({ userId });
  const { MsgSettings } = require('./habarMatni');
  const msg    = await MsgSettings.findOne({ userId });

  const running    = !!(user?.isRunning || isRunning(userId));
  const groupMode  = user?.groupMode || 'all';
  const interval   = user?.interval  || 300;
  const autoStop   = user?.autoStopLimit;
  const mentionOn  = !!user?.mentionEnabled;

  let groupCount = 0;
  if (acc) {
    if (groupMode === 'selected') {
      groupCount = user?.selectedGroups?.length || 0;
    } else {
      try {
        const { fetchLiveGroups } = require('./guruhlar');
        const groups = await fetchLiveGroups(acc);
        groupCount = groups.length;
      } catch { groupCount = 0; }
    }
  }

  const msgType = msg?.type === 'photo' ? 'Rasm+matn'
                : msg?.type === 'button' ? 'Tugmali matn'
                : msg?.text ? 'Matn' : 'Sozlanmagan';

  const phoneDisplay    = acc ? `++${acc.phone.replace(/^\+/, '')}` : '❌';
  const usernameDisplay = ctx.from.username ? `(@${ctx.from.username})` : '';

  // Legacy Markdown ishlatamiz — escaping talab qilmaydi (faqat _*`[ belgilar muammoli,
  // ular yuqoridagi qiymatlarda yo'q).
  const text =
    `🧑‍💼 *Boshqaruv panel*\n` +
    `${'━'.repeat(18)}\n\n` +
    `👤 Profil: ${phoneDisplay} ${usernameDisplay}\n` +
    `⚙️ Holat: ${running ? '🟢 Yoqiq' : '🔴 O\'chiq'}\n` +
    `🖼 Xabar turi: *${msgType}*\n` +
    `💬 Guruhlar: *${groupCount}*\n` +
    `⏳ Interval: *${interval} soniya*\n` +
    `⏱ Avto-o'chish: ${autoStop ? `*${autoStop} marta*` : '♾ *Cheksiz*'}\n` +
    `📛 Mention: *${mentionOn ? 'Yoqiq' : 'O\'chiq'}*\n` +
    `${'━'.repeat(18)}`;

  const kb = Markup.inlineKeyboard([
    [
      running
        ? Markup.button.callback('⏸ To\'xtatish', 'autohabar_stop')
        : Markup.button.callback('▶️ Ishga tushurish', 'autohabar_start'),
      Markup.button.callback('🔴 Statistika', 'autohabar_stats')
    ],
    [
      Markup.button.callback('⏱ Avto-o\'chirish taymer', 'autohabar_autostop'),
      Markup.button.callback(`💬 Mention: ${mentionOn ? 'Yoqiq' : "O'chiq"}`, 'autohabar_mention')
    ],
    [Markup.button.callback('⬅️ Yopish', 'autohabar_close')]
  ]);

  return { text, kb };
}

async function renderControlPanel(ctx, { edit = false } = {}) {
  const { text, kb } = await buildControlPanel(ctx);
  const opts = { parse_mode: 'Markdown', ...kb };
  if (edit) {
    try { return await ctx.editMessageText(text, opts); } catch { return ctx.reply(text, opts); }
  }
  return ctx.reply(text, opts);
}

bot.action('autohabar_start', async (ctx) => {
  await ctx.answerCbQuery('▶️ Ishga tushirilmoqda...');
  const userId = ctx.from.id;

  const acc = await Account.findOne({ userId, isActive: true });
  if (!acc) return ctx.answerCbQuery('❌ Avval akkaunt qo\'shing!', { show_alert: true });

  const { MsgSettings } = require('./habarMatni');
  const msg = await MsgSettings.findOne({ userId });
  if (!msg?.text) return ctx.answerCbQuery('❌ Avval habar matnini kiriting!', { show_alert: true });

  await startAutoSend(userId, bot);
  await renderControlPanel(ctx, { edit: true });
});

bot.action('autohabar_stop', async (ctx) => {
  await ctx.answerCbQuery('⏸ To\'xtatildi');
  await stopAutoSend(ctx.from.id);
  await renderControlPanel(ctx, { edit: true });
});

bot.action('autohabar_stats', async (ctx) => {
  const user = await User.findOne({ userId: ctx.from.id });
  const sent = user?.sentCount || 0;
  const limit = user?.autoStopLimit;
  await ctx.answerCbQuery(
    `📊 Yuborilgan: ${sent} marta` + (limit ? ` (${sent}/${limit})` : ''),
    { show_alert: true }
  );
});

bot.action('autohabar_autostop', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    '⏱ *Avto-o\'chirish taymerini tanlang:*\n\nNecha marta yuborilgach avtomatik to\'xtasin?',
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('10 marta', 'autostop_10'),
          Markup.button.callback('50 marta', 'autostop_50')
        ],
        [
          Markup.button.callback('100 marta', 'autostop_100'),
          Markup.button.callback('♾ Cheksiz', 'autostop_0')
        ]
      ])
    }
  );
});

bot.action(/^autostop_(\d+)$/, async (ctx) => {
  const val = parseInt(ctx.match[1], 10);
  await User.findOneAndUpdate(
    { userId: ctx.from.id },
    { autoStopLimit: val === 0 ? null : val },
    { upsert: true }
  );
  await ctx.answerCbQuery(val === 0 ? '♾ Cheksiz qilib qo\'yildi' : `⏱ ${val} martaga o'rnatildi`);
  try { await ctx.deleteMessage(); } catch {}
  await renderControlPanel(ctx, { edit: false });
});

bot.action('autohabar_mention', async (ctx) => {
  const userId = ctx.from.id;
  await getEffectiveTarif(userId); // muddati o'tgan bo'lsa Free ga tushiradi

  const user  = await User.findOne({ userId });
  const isPro = user?.tarif === 'pro';

  if (!isPro) {
    await ctx.answerCbQuery("👑 Mention faqat Pro tarifda ishlaydi!", { show_alert: true });
    return;
  }

  const newVal = !user?.mentionEnabled;
  await User.findOneAndUpdate({ userId }, { mentionEnabled: newVal }, { upsert: true });
  await ctx.answerCbQuery(newVal ? '📛 Mention yoqildi' : "📛 Mention o'chirildi");
  await renderControlPanel(ctx, { edit: true });
});

bot.action('autohabar_close', async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.deleteMessage(); } catch {}
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

// 🚀 AUTOHABAR — Boshqaruv paneli
bot.hears('🚀 Autohabar yuborish', async (ctx) => {
  const acc = await Account.findOne({ userId: ctx.from.id, isActive: true });
  if (!acc) {
    return ctx.reply('⚠️ Avval akkaunt qo\'shing!',
      Markup.inlineKeyboard([[Markup.button.callback('➕ Akkaunt qo\'shish', 'add_account')]])
    );
  }
  await renderControlPanel(ctx, { edit: false });
});
bot.hears('✏️ Habar matni',        habarMatniHandler);
bot.hears('⏱ Interval',            intervalHandler);
bot.hears('💬 Guruhlarni sozlash', guruhlarHandler);
bot.hears('👤 Profillar',          profillarHandler);

function progressBar(current, total, size = 15) {
  const filled = Math.min(size, Math.round((current / total) * size));
  return '█'.repeat(filled) + '░'.repeat(size - filled);
}

async function showProTarif(ctx) {
  const userId = ctx.from.id;
  await getEffectiveTarif(userId); // muddati o'tgan bo'lsa Free ga tushiradi
  const user   = await User.findOne({ userId });
  const tarif  = user?.tarif === 'pro' ? 'Pro' : 'Free';
  const refCount = user?.referralCount || 0;
  const refGoal  = 15;

  const botUsername = ctx.botInfo?.username || 'Autoxabarcbot';
  const refLink = `https://t.me/${botUsername}?start=ref_${userId}_0`;

  const expiryLine = (tarif === 'Pro' && user?.proExpiresAt)
    ? `📅 Amal qilish muddati: ${new Date(user.proExpiresAt).toLocaleDateString('uz-UZ')} gacha\n\n`
    : '';

  const text = expiryLine +
    `💎 <b>AutoHabar Pro</b>\n\n` +
    `🔋 ${tarif === 'Pro' ? '✅' : '❌'} Siz <b>${tarif}</b> tarifdasiz\n\n` +
    `<blockquote expandable>` +
    `🚀 <b>Pro imkoniyatlari:</b>\n\n` +
    `👤 Ko'p profil: 5 tagacha akkaunt\n` +
    `❗️ Watermarksiz (reklama belgisi yo'q)\n` +
    `🔍 Reklamasiz (toza interfeys)\n` +
    `➡️ Forward xabar yuborish\n` +
    `🖼 Har profil uchun mustaqil sozlamalar\n` +
    `⚙️ Tugmali xabar (Inline mode)\n` +
    `⏰ Tezkor tsikl va minimal kechikish\n` +
    `🔀 Turli habarlar (2\u20134 xil, navbatma-navbat)\n` +
    `⚙️ Mention — guruh a'zolarini @ qilish\n` +
    `🖼 Avtomatik obuna (AutoSub) — kanallarni topib obuna bo'lish` +
    `</blockquote>\n\n` +
    `<blockquote expandable>` +
    `⭐ <b>Narxlar:</b>\n` +
    `• Karta: 35,000 so'm / 30 kun\n` +
    `⭐ Stars: 20 / 1 kun\n` +
    `⭐ Stars: 70 / 7 kun\n` +
    `⭐ Stars: 250 / 30 kun\n` +
    `💵 USDT: 0.40 / 1 kun\n` +
    `💵 USDT: 1.20 / 7 kun\n` +
    `💵 USDT: 5.00 / 30 kun` +
    `</blockquote>\n\n` +
    `<blockquote expandable>` +
    `🎁 <b>Bepul PRO olish:</b>\n\n` +
    `Botga <b>${refGoal} ta</b> do'stingizni taklif qiling va <b>bepulga 7 kunlik PRO</b> oling!\n` +
    `Do'stlaringiz barcha kanallarga obuna bo'lishlari zarur! ✅\n\n` +
    `📊 Holat: ${refCount}/${refGoal}\n` +
    `[${progressBar(refCount, refGoal)}]\n\n` +
    `🔗 Havolangiz:\n${refLink}` +
    `</blockquote>`;

  await ctx.reply(text, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [
        Markup.button.callback('⭐ Stars orqali sotib olish', 'pro_buy_stars'),
        Markup.button.callback('💳 Karta orqali sotib olish', 'pro_buy_card')
      ]
    ])
  });
}

bot.hears('👑 Pro tarif', showProTarif);
bot.action('pro_tarif_menu', async (ctx) => { await ctx.answerCbQuery(); await showProTarif(ctx); });

bot.action('pro_buy_stars', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    '⭐ *Stars orqali to\'lov*\n\nKerakli muddatni tanlang:',
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('20 ⭐ / 1 kun', 'pay_stars_20')],
        [Markup.button.callback('70 ⭐ / 7 kun', 'pay_stars_70')],
        [Markup.button.callback('250 ⭐ / 30 kun', 'pay_stars_250')]
      ])
    }
  );
});

bot.action('pro_buy_card', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    '💳 *Karta orqali to\'lov*\n\n35,000 so\'m / 30 kun\n\n📞 To\'lov uchun admin bilan bog\'laning: @admin',
    { parse_mode: 'Markdown' }
  );
});

// ─── STARS TARIFLARI: miqdor → (kun, tavsif) ─────────────────────────────────
const STARS_PLANS = {
  20:  { days: 1,  label: '1 kunlik Pro' },
  70:  { days: 7,  label: '7 kunlik Pro' },
  250: { days: 30, label: '30 kunlik Pro' }
};

// ─── Stars invoice yuborish ───────────────────────────────────────────────────
bot.action(/^pay_stars_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const amount = parseInt(ctx.match[1], 10);
  const plan   = STARS_PLANS[amount];

  if (!plan) return ctx.reply('❌ Noto\'g\'ri tarif tanlandi.');

  try {
    await ctx.telegram.sendInvoice(ctx.chat.id, {
      title:          `AutoHabar Pro — ${plan.label}`,
      description:    `Pro tarifga o'tish: ${plan.days} kun davomida barcha Pro imkoniyatlar ochiladi.`,
      // payload ichida userId va kun sonini kodlaymiz — to'lov tasdiqlanganda o'qiymiz
      payload:        `pro_${ctx.from.id}_${plan.days}_${Date.now()}`,
      provider_token: '',       // Telegram Stars uchun bo'sh qoldiriladi
      currency:       'XTR',    // Telegram Stars valyutasi
      prices:         [{ label: plan.label, amount }],
      start_parameter: `pro_${plan.days}d`
    });
  } catch (err) {
    console.error('[stars] invoice yuborishda xato:', err.message);
    await ctx.reply(`❌ To'lov oynasini ochib bo'lmadi.\n\`${err.message}\``, { parse_mode: 'Markdown' });
  }
});

// ─── Pre-checkout — Telegram to'lovdan oldin tasdiq so'raydi ─────────────────
bot.on('pre_checkout_query', async (ctx) => {
  try {
    await ctx.answerPreCheckoutQuery(true);
  } catch (err) {
    console.error('[stars] pre_checkout xato:', err.message);
    await ctx.answerPreCheckoutQuery(false, 'Xatolik yuz berdi, qayta urinib ko\'ring.');
  }
});

// ─── To'lov muvaffaqiyatli bo'lganda — Pro tarifni yoqamiz ───────────────────
bot.on('message', async (ctx, next) => {
  const payment = ctx.message?.successful_payment;
  if (!payment) return next();

  try {
    const userId = ctx.from.id;
    const parts  = payment.invoice_payload.split('_'); // ['pro', userId, days, ts]
    const days   = parseInt(parts[2], 10) || 30;

    const user = await User.findOne({ userId });
    const now  = new Date();
    // Agar hali Pro muddati tugamagan bo'lsa — kunlar ustiga qo'shamiz, aks holda bugundan boshlab
    const base = (user?.proExpiresAt && user.proExpiresAt > now) ? user.proExpiresAt : now;
    const newExpiry = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);

    await User.findOneAndUpdate(
      { userId },
      { tarif: 'pro', proExpiresAt: newExpiry },
      { upsert: true }
    );

    await ctx.reply(
      `✅ *To'lov muvaffaqiyatli qabul qilindi!*\n\n` +
      `💎 Pro tarif ${days} kunga faollashtirildi.\n` +
      `📅 Amal qilish muddati: ${newExpiry.toLocaleDateString('uz-UZ')} gacha\n\n` +
      `Barcha Pro imkoniyatlar endi ochiq! 🚀`,
      { parse_mode: 'Markdown' }
    );

    console.log(`[stars] userId:${userId} Pro tarifga o'tdi (${days} kun, ${payment.total_amount} XTR)`);
  } catch (err) {
    console.error('[stars] successful_payment ishlov berishda xato:', err.message);
    await ctx.reply('⚠️ To\'lov qabul qilindi, lekin faollashtirishda xato yuz berdi. Admin bilan bog\'laning.');
  }
});

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
