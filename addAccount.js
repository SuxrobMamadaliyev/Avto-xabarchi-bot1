const { Scenes, Markup } = require('telegraf');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram');
const Account = require('./Account');

// Vaqtinchalik client saqlash (scene davomida)
const pendingClients = new Map();

const addAccountScene = new Scenes.WizardScene(
  'ADD_ACCOUNT',

  // ── STEP 1: API ID so'rash ────────────────────────────────────────────────
  async (ctx) => {
    await ctx.reply(
      '📲 *Akkaunt qo\'shish*\n\n' +
      '*1-qadam:* API ID kiriting\n\n' +
      '🔗 [my.telegram.org](https://my.telegram.org) → API development tools',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('❌ Bekor qilish', 'cancel_add')]
        ])
      }
    );
    return ctx.wizard.next();
  },

  // ── STEP 2: API Hash so'rash ─────────────────────────────────────────────
  async (ctx) => {
    if (ctx.callbackQuery?.data === 'cancel_add') {
      await ctx.answerCbQuery();
      await ctx.reply('❌ Bekor qilindi');
      return ctx.scene.leave();
    }

    const apiId = ctx.message?.text?.trim();
    if (!apiId || isNaN(apiId) || parseInt(apiId) <= 0) {
      await ctx.reply('⚠️ Noto\'g\'ri format. Faqat son kiriting:\nMasalan: `12345678`', {
        parse_mode: 'Markdown'
      });
      return;
    }

    ctx.wizard.state.apiId = parseInt(apiId);

    await ctx.reply(
      '*2-qadam:* API Hash kiriting\n\n' +
      '_(my.telegram.org dan olingan hash)_',
      { parse_mode: 'Markdown' }
    );
    return ctx.wizard.next();
  },

  // ── STEP 3: Telefon raqam so'rash ────────────────────────────────────────
  async (ctx) => {
    if (ctx.callbackQuery?.data === 'cancel_add') {
      await ctx.answerCbQuery();
      await ctx.reply('❌ Bekor qilindi');
      return ctx.scene.leave();
    }

    const apiHash = ctx.message?.text?.trim();
    if (!apiHash || apiHash.length < 20) {
      await ctx.reply('⚠️ API Hash noto\'g\'ri. Qayta kiriting:');
      return;
    }

    ctx.wizard.state.apiHash = apiHash;

    await ctx.reply(
      '*3-qadam:* Telefon raqamingizni kiriting\n\n' +
      'Masalan: `+998901234567`',
      { parse_mode: 'Markdown' }
    );
    return ctx.wizard.next();
  },

  // ── STEP 4: Telefon jo'natish va OTP so'rash ─────────────────────────────
  async (ctx) => {
    if (ctx.callbackQuery?.data === 'cancel_add') {
      await ctx.answerCbQuery();
      await ctx.reply('❌ Bekor qilindi');
      return ctx.scene.leave();
    }

    const phone = ctx.message?.text?.trim();
    if (!phone || !phone.startsWith('+') || phone.length < 10) {
      await ctx.reply(
        '⚠️ Telefon raqam noto\'g\'ri.\n' +
        'Masalan: `+998901234567`',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    ctx.wizard.state.phone = phone;
    const { apiId, apiHash } = ctx.wizard.state;
    const userId = ctx.from.id;

    const loadingMsg = await ctx.reply('⏳ Telegram-ga ulanilmoqda...');

    try {
      const client = new TelegramClient(
        new StringSession(''),
        apiId,
        apiHash,
        {
          connectionRetries: 5,
          useWSS: false,
        }
      );

      await client.connect();

      const result = await client.sendCode({ apiId, apiHash }, phone);

      pendingClients.set(userId, {
        client,
        phoneCodeHash: result.phoneCodeHash,
        apiId,
        apiHash,
        phone
      });

      try {
        await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id);
      } catch {}

      await ctx.reply(
        '✅ Tasdiqlash kodi yuborildi!\n\n' +
        '*4-qadam:* Telegramdan kelgan *5 xonali kodni* kiriting:\n\n' +
        '💡 Agar kod `12345` bo\'lsa, shunday yozing: `1 2 3 4 5` yoki `12345`',
        { parse_mode: 'Markdown' }
      );
      return ctx.wizard.next();

    } catch (err) {
      console.error('[addAccount] sendCode error:', err.message);
      pendingClients.delete(userId);

      try {
        await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id);
      } catch {}

      let errMsg = '❌ Xatolik yuz berdi.';
      if (err.message.includes('API_ID_INVALID'))    errMsg = '❌ API ID noto\'g\'ri!';
      if (err.message.includes('API_ID_PUBLISHED_FLOOD')) errMsg = '❌ Bu API ID bloklangan!';
      if (err.message.includes('PHONE_NUMBER_INVALID')) errMsg = '❌ Telefon raqam noto\'g\'ri!';
      if (err.message.includes('PHONE_NUMBER_BANNED')) errMsg = '❌ Bu raqam Telegram-dan ban yegan!';

      await ctx.reply(`${errMsg}\n\n/start bosib qayta boshlang`);
      return ctx.scene.leave();
    }
  },

  // ── STEP 5: OTP tekshirish ───────────────────────────────────────────────
  async (ctx) => {
    if (ctx.callbackQuery?.data === 'cancel_add') {
      await ctx.answerCbQuery();
      pendingClients.delete(ctx.from.id);
      await ctx.reply('❌ Bekor qilindi');
      return ctx.scene.leave();
    }

    const code = ctx.message?.text?.trim().replace(/\s/g, '');
    const userId = ctx.from.id;
    const pending = pendingClients.get(userId);

    if (!pending) {
      await ctx.reply('❌ Session topilmadi. /start bosib qayta boshlang.');
      return ctx.scene.leave();
    }

    if (!code || !/^\d{5,6}$/.test(code)) {
      await ctx.reply('⚠️ Kod 5-6 ta raqamdan iborat bo\'lishi kerak. Qayta kiriting:');
      return;
    }

    try {
      const { client, phoneCodeHash, phone, apiId, apiHash } = pending;

      await client.invoke(
        new Api.auth.SignIn({
          phoneNumber: phone,
          phoneCodeHash,
          phoneCode: code
        })
      );

      await saveAccount(ctx, client, pending);
      return ctx.scene.leave();

    } catch (err) {
      console.error('[addAccount] signIn error:', err.message);

      if (err.message.includes('SESSION_PASSWORD_NEEDED')) {
        await ctx.reply(
          '🔐 *2 bosqichli tasdiqlash (2FA) yoqilgan!*\n\n' +
          '*5-qadam:* Telegram parolингизни kiriting:',
          { parse_mode: 'Markdown' }
        );
        return ctx.wizard.next();
      }

      if (err.message.includes('PHONE_CODE_INVALID')) {
        await ctx.reply('❌ Noto\'g\'ri kod! Qayta kiriting:');
        return;
      }

      if (err.message.includes('PHONE_CODE_EXPIRED')) {
        pendingClients.delete(userId);
        await ctx.reply('❌ Kod muddati o\'tib ketdi. /start bosib qayta boshlang.');
        return ctx.scene.leave();
      }

      pendingClients.delete(userId);
      await ctx.reply(`❌ Xatolik: ${err.message}\n\n/start bosib qayta boshlang`);
      return ctx.scene.leave();
    }
  },

  // ── STEP 6: 2FA parol ────────────────────────────────────────────────────
  async (ctx) => {
    if (ctx.callbackQuery?.data === 'cancel_add') {
      await ctx.answerCbQuery();
      pendingClients.delete(ctx.from.id);
      await ctx.reply('❌ Bekor qilindi');
      return ctx.scene.leave();
    }

    const password = ctx.message?.text?.trim();
    const userId = ctx.from.id;
    const pending = pendingClients.get(userId);

    if (!pending) {
      await ctx.reply('❌ Session topilmadi. /start bosib qayta boshlang.');
      return ctx.scene.leave();
    }

    if (!password) {
      await ctx.reply('⚠️ Parol bo\'sh bo\'lishi mumkin emas. Qayta kiriting:');
      return;
    }

    try {
      const { client, apiId, apiHash } = pending;

      await client.signInWithPassword(
        { apiId, apiHash },
        {
          password: async () => password,
          onError: async (err) => { throw err; }
        }
      );

      await saveAccount(ctx, client, pending);
      return ctx.scene.leave();

    } catch (err) {
      console.error('[addAccount] 2FA error:', err.message);

      if (err.message.includes('PASSWORD_HASH_INVALID')) {
        await ctx.reply('❌ Noto\'g\'ri parol! Qayta kiriting:');
        return;
      }

      pendingClients.delete(ctx.from.id);
      await ctx.reply(`❌ Xatolik: ${err.message}\n\n/start bosib qayta boshlang`);
      return ctx.scene.leave();
    }
  }
);

// ── Helper: Akkauntni saqlash ─────────────────────────────────────────────────
async function saveAccount(ctx, client, pending) {
  const { phone, apiId, apiHash } = pending;
  const userId = ctx.from.id;

  const sessionString = client.session.save();
  await client.disconnect();
  pendingClients.delete(userId);

  try {
    await Account.findOneAndUpdate(
      { userId, phone },
      { userId, phone, apiId, apiHash, session: sessionString, isActive: true },
      { upsert: true, new: true }
    );

    await ctx.reply(
      '✅ *Akkaunt muvaffaqiyatli qo\'shildi!*\n\n' +
      `📱 Telefon: \`${phone}\`\n` +
      '🟢 Holat: Faol\n' +
      '💾 Session: MongoDB-ga saqlandi',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🏠 Bosh menyuga', 'main_menu')]
        ])
      }
    );
  } catch (err) {
    console.error('[addAccount] saveAccount error:', err.message);
    await ctx.reply('❌ Saqlashda xatolik. Qayta urinib ko\'ring.');
  }
}

// Callback: bekor qilish
addAccountScene.action('cancel_add', async (ctx) => {
  await ctx.answerCbQuery();
  pendingClients.delete(ctx.from.id);
  await ctx.reply('❌ Bekor qilindi');
  return ctx.scene.leave();
});

module.exports = addAccountScene;
