require('dotenv').config();
const { Telegraf, Scenes, session, Markup } = require('telegraf');
const mongoose = require('mongoose');

const bot = new Telegraf(process.env.BOT_TOKEN);

// Models
const User = require('./User');
const Account = require('./Account');

// Scenes
const addAccountScene = require('./addAccount');

// Stage
const stage = new Scenes.Stage([addAccountScene]);
bot.use(session());
bot.use(stage.middleware());

// MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB ulandi'))
  .catch(err => console.error('❌ MongoDB xato:', err));

// ─── MAJBURIY OBUNA TEKSHIRISH ───────────────────────────────────────────────
const CHANNELS = process.env.CHANNELS
  ? process.env.CHANNELS.split(',').map(c => c.trim())
  : []; // .env da: CHANNELS=@channel1,@channel2

async function checkSubscription(ctx) {
  if (!CHANNELS.length) return true;
  for (const channel of CHANNELS) {
    try {
      const member = await ctx.telegram.getChatMember(channel, ctx.from.id);
      if (['left', 'kicked'].includes(member.status)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function subscribeKeyboard() {
  const buttons = CHANNELS.map((ch, i) =>
    [Markup.button.url(`📢 Kanal ${i + 1}`, `https://t.me/${ch.replace('@', '')}`)]
  );
  buttons.push([Markup.button.callback('✅ Obuna bo\'ldim', 'check_sub')]);
  return Markup.inlineKeyboard(buttons);
}

// ─── ASOSIY MENYU ────────────────────────────────────────────────────────────
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

async function showMainMenu(ctx, user) {
  const accounts = await Account.find({ userId: ctx.from.id, isActive: true });
  const acc = accounts[0];

  const text =
    `◈ *AUTO HABAR PRO*\n` +
    `${'─'.repeat(30)}\n\n` +
    `Salom, ${ctx.from.first_name} 👋\n\n` +
    `› Akkaunt qo'shing\n` +
    `› Guruhlarni sozlang\n` +
    `› Habarni sozlang\n` +
    `› Autohabarni ishga tushuring`;

  await ctx.reply(text, {
    parse_mode: 'Markdown',
    ...mainMenuKeyboard()
  });

  // Status xabar
  const statusText =
    `👤 *Ulangan:* ${acc ? `\`${acc.phone}\`` : 'Yo\'q'}\n\n` +
    `🤖 Auto Habar: ❌ O'chiq\n` +
    `⭐ Sizning Tarifingiz: 💙 *Bepul*\n` +
    `⏱ Interval: 120 soniya\n\n` +
    `👇\n` +
    `_Kerakli tugmani pastdan tanlang:_`;

  const inlineButtons = acc
    ? Markup.inlineKeyboard([
        [Markup.button.callback('➕ Akkaunt qo\'shish', 'add_account')],
      ])
    : Markup.inlineKeyboard([
        [Markup.button.callback('➕ Akkaunt qo\'shish', 'add_account')],
      ]);

  await ctx.reply(statusText, {
    parse_mode: 'Markdown',
    ...inlineButtons
  });
}

// ─── /start ──────────────────────────────────────────────────────────────────
bot.start(async (ctx) => {
  // Foydalanuvchini saqlash
  await User.findOneAndUpdate(
    { userId: ctx.from.id },
    {
      userId: ctx.from.id,
      username: ctx.from.username,
      firstName: ctx.from.first_name,
      lastSeen: new Date()
    },
    { upsert: true, new: true }
  );

  // Majburiy obuna tekshirish
  const subscribed = await checkSubscription(ctx);
  if (!subscribed) {
    await ctx.reply(
      '📢 *Botdan foydalanish uchun quyidagi kanallarga obuna bo\'ling:*',
      {
        parse_mode: 'Markdown',
        ...subscribeKeyboard()
      }
    );
    return;
  }

  await ctx.reply('✅ Obuna tasdiqlandi!');
  await ctx.reply('📊 *Asosiy menyu:*', { parse_mode: 'Markdown' });
  await showMainMenu(ctx, ctx.from);
});

// Obuna tekshirish callback
bot.action('check_sub', async (ctx) => {
  await ctx.answerCbQuery();
  const subscribed = await checkSubscription(ctx);
  if (!subscribed) {
    await ctx.answerCbQuery('❌ Hali obuna bo\'lmagansiz!', { show_alert: true });
    return;
  }
  await ctx.deleteMessage();
  await ctx.reply('✅ Obuna tasdiqlandi!');
  await ctx.reply('📊 *Asosiy menyu:*', { parse_mode: 'Markdown' });
  await showMainMenu(ctx, ctx.from);
});

// ─── INLINE TUGMALAR ─────────────────────────────────────────────────────────
bot.action('add_account', (ctx) => {
  ctx.answerCbQuery();
  ctx.scene.enter('ADD_ACCOUNT');
});

bot.action('main_menu', async (ctx) => {
  ctx.answerCbQuery();
  await showMainMenu(ctx, ctx.from);
});

// ─── KEYBOARD TUGMALARI ──────────────────────────────────────────────────────
bot.hears('🚀 Autohabar yuborish', async (ctx) => {
  const acc = await Account.findOne({ userId: ctx.from.id, isActive: true });
  if (!acc) {
    return ctx.reply(
      '⚠️ Akkaunt qo\'shilmagan!\n\nAvval akkaunt qo\'shing.',
      Markup.inlineKeyboard([
        [Markup.button.callback('➕ Akkaunt qo\'shish', 'add_account')]
      ])
    );
  }
  await ctx.reply('🚀 Autohabar yuborish sozlamalari (tez kunda)...');
});

bot.hears('✏️ Habar matni', async (ctx) => {
  await ctx.reply('✏️ Habar matnini kiriting (tez kunda)...');
});

bot.hears('⏱ Interval', async (ctx) => {
  await ctx.reply('⏱ Interval sozlash (tez kunda)...');
});

bot.hears('💬 Guruhlarni sozlash', async (ctx) => {
  await ctx.reply('💬 Guruhlarni sozlash (tez kunda)...');
});

bot.hears('👤 Profillar', async (ctx) => {
  const accounts = await Account.find({ userId: ctx.from.id });
  if (!accounts.length) {
    return ctx.reply('👤 Hech qanday akkaunt topilmadi.');
  }
  const list = accounts.map((a, i) =>
    `${i + 1}. \`${a.phone}\` — ${a.isActive ? '🟢 Faol' : '🔴 Nofaol'}`
  ).join('\n');
  await ctx.reply(`👤 *Akkauntlar:*\n\n${list}`, { parse_mode: 'Markdown' });
});

bot.hears('👑 Pro tarif', async (ctx) => {
  await ctx.reply(
    '👑 *Pro Tarif*\n\n' +
    '✅ Cheksiz guruhlar\n' +
    '✅ Tez interval\n' +
    '✅ Ko\'p akkaunt\n\n' +
    '💰 Narx: So\'rov asosida',
    { parse_mode: 'Markdown' }
  );
});

bot.hears('🗂 Kabinet', async (ctx) => {
  const user = await User.findOne({ userId: ctx.from.id });
  const accounts = await Account.countDocuments({ userId: ctx.from.id });
  await ctx.reply(
    `🗂 *Kabinet*\n\n` +
    `👤 Ism: ${ctx.from.first_name}\n` +
    `🆔 ID: \`${ctx.from.id}\`\n` +
    `📱 Akkauntlar: ${accounts} ta\n` +
    `⭐ Tarif: Bepul`,
    { parse_mode: 'Markdown' }
  );
});

bot.hears('⚙️ Sozlamalar', async (ctx) => {
  await ctx.reply('⚙️ Sozlamalar (tez kunda)...');
});

bot.hears('📅 Kalendar', async (ctx) => {
  await ctx.reply('📅 Kalendar (tez kunda)...');
});

bot.hears('🔧 Foydali funksiyalar', async (ctx) => {
  await ctx.reply('🔧 Foydali funksiyalar (tez kunda)...');
});

bot.hears('📊 Statistika', async (ctx) => {
  await ctx.reply('📊 Statistika (tez kunda)...');
});

bot.hears('🙋 Yordam', async (ctx) => {
  await ctx.reply(
    '🙋 *Yordam*\n\n' +
    '1. Akkaunt qo\'shing\n' +
    '2. Guruhlarni tanlang\n' +
    '3. Habar matnini yozing\n' +
    '4. Intervalni sozlang\n' +
    '5. Autohabarni yoqing\n\n' +
    '📞 Admin: @admin',
    { parse_mode: 'Markdown' }
  );
});

bot.hears('📖 Qo\'llanma', async (ctx) => {
  await ctx.reply('📖 Qo\'llanma (tez kunda)...');
});

bot.hears('↩️ Autoreply', async (ctx) => {
  await ctx.reply('↩️ Autoreply (tez kunda)...');
});

// ─── LAUNCH ──────────────────────────────────────────────────────────────────
if (process.env.WEBHOOK_URL) {
  bot.launch({ webhook: { domain: process.env.WEBHOOK_URL, port: process.env.PORT || 3000 } });
} else {
  bot.launch();
}

console.log('🤖 Bot ishga tushdi...');
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
