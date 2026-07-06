const { Scenes, Markup } = require('telegraf');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram');
const Account = require('./Account');
const User    = require('./User');

const API_ID   = parseInt(process.env.API_ID);
const API_HASH = process.env.API_HASH;

// ─── Tarif bo'yicha akkaunt limiti ────────────────────────────────────────────
const ACCOUNT_LIMITS = { free: 1, pro: 5 };

// Pro muddati o'tgan bo'lsa avtomatik Free ga tushiradi (bir joyda ham ishlatiladi)
async function getEffectiveTarif(userId) {
  const user = await User.findOne({ userId });
  if (user?.tarif === 'pro' && user.proExpiresAt && user.proExpiresAt < new Date()) {
    await User.findOneAndUpdate({ userId }, { tarif: 'free' });
    return 'free';
  }
  return user?.tarif === 'pro' ? 'pro' : 'free';
}

// Vaqtinchalik clientlar (scene davomida)
const pendingClients = new Map();

const addAccountScene = new Scenes.WizardScene(
  'ADD_ACCOUNT',

  // ── STEP 1: Telefon raqam so'rash ─────────────────────────────────────────
  async (ctx) => {
    const userId = ctx.from.id;
    const tarif  = await getEffectiveTarif(userId);
    const limit  = ACCOUNT_LIMITS[tarif];
    const count  = await Account.countDocuments({ userId });

    if (count >= limit) {
      await ctx.reply(
        `⚠️ *Akkaunt limiti to'ldi!*\n\n` +
        `📱 Sizda hozir: ${count}/${limit} akkaunt\n` +
        `💎 Tarifingiz: ${tarif === 'pro' ? 'Pro' : 'Free'}\n\n` +
        (tarif === 'free'
          ? `Ko'proq akkaunt ulash uchun Pro tarifga o'ting (5 tagacha akkaunt).`
          : `Pro tarifda maksimal 5 ta akkaunt ulash mumkin.`),
        {
          parse_mode: 'Markdown',
          ...(tarif === 'free'
            ? Markup.inlineKeyboard([[Markup.button.callback('👑 Pro tarifga o\'tish', 'pro_tarif_menu')]])
            : {})
        }
      );
      return ctx.scene.leave();
    }

    await ctx.reply(
      '📲 *Akkaunt ulash*\n\n' +
      'Telefon raqamingizni kiriting:\n\n' +
      'Masalan: `+998901234567`',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('❌ Bekor qilish', 'cancel_add')]
        ])
      }
    );
    return ctx.wizard.next();
  },

  // ── STEP 2: Kodni yuborish ────────────────────────────────────────────────
  async (ctx) => {
    if (ctx.callbackQuery?.data === 'cancel_add') {
      await ctx.answerCbQuery();
      await ctx.reply('❌ Bekor qilindi');
      return ctx.scene.leave();
    }

    const phone = ctx.message?.text?.trim();
    if (!phone || !phone.startsWith('+') || phone.length < 10) {
      await ctx.reply('⚠️ Telefon raqamni + bilan kiriting:\nMasalan: `+998901234567`', {
        parse_mode: 'Markdown'
      });
      return;
    }

    ctx.wizard.state.phone = phone;
    const userId = ctx.from.id;

    const loadingMsg = await ctx.reply('⏳ Ulanilmoqda...');

    let client; // catch blokida ham ishlatiladi, shuning uchun tashqarida e'lon qilinadi
    try {
      client = new TelegramClient(
        new StringSession(''),
        API_ID,
        API_HASH,
        { connectionRetries: 5 }
      );

      await client.connect();

      // forceSMS: false — GramJS "forceSMS: true" bo'lsa ichkarida avtomatik
      // auth.ResendCode chaqiradi va ba'zi raqamlarda shu resend
      // "406: SEND_CODE_UNAVAILABLE" bilan tushib qoladi. Shu sabab Telegram
      // o'zi tanlagan standart usulda (odatda ilova ichidan) yuboramiz.
      const result = await client.sendCode(
        { apiId: API_ID, apiHash: API_HASH },
        phone,
        false
      );

      console.log(`[addAccount] Kod yuborildi -> phone: ${phone}, viaApp: ${result.isCodeViaApp}`);

      pendingClients.set(userId, {
        client,
        phoneCodeHash: result.phoneCodeHash,
        phone
      });

      try { await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id); } catch {}

      await ctx.reply(
        '✅ Kod yuborildi!\n\n' +
        (result.isCodeViaApp
          ? '📩 Kod *Telegram ilovangizga* (Xabarlar/Telegram xizmat chati) keldi.\n\n'
          : '📩 Kod *SMS orqali* keldi.\n\n') +
        'Kelgan *5 xonali kodni* kiriting:',
        { parse_mode: 'Markdown' }
      );
      return ctx.wizard.next();

    } catch (err) {
      console.error('[addAccount] sendCode:', err.message);
      try { await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id); } catch {}
      try { await client.disconnect(); } catch {}

      let msg = `❌ Xatolik: ${err.message}`; // vaqtincha: aniq xatoni ko'rsatamiz (debug uchun)
      if (err.message.includes('PHONE_NUMBER_INVALID')) msg = '❌ Telefon raqam noto\'g\'ri!';
      if (err.message.includes('PHONE_NUMBER_BANNED'))  msg = '❌ Bu raqam ban yegan!';
      if (err.message.includes('API_ID_INVALID'))       msg = '❌ API sozlamalarida xato. Adminga murojaat qiling.';
      if (err.message.includes('SEND_CODE_UNAVAILABLE')) {
        msg = '❌ Bu raqamga hozir kod yuborib bo\'lmadi (Telegram vaqtincha rad etdi).\n\n' +
              'Bir necha daqiqadan so\'ng qayta urinib ko\'ring, yoki boshqa raqam bilan sinab ko\'ring.';
      }
      if (err.message.includes('FLOOD_WAIT')) {
        const seconds = err.message.match(/FLOOD_WAIT_(\d+)/)?.[1] || '?';
        msg = `⏳ Juda ko'p urinish qildingiz. Telegram ${seconds} soniyaga bloklagan. Shuncha vaqtdan keyin qayta urinib ko'ring.`;
      }

      await ctx.reply(msg);
      return ctx.scene.leave();
    }
  },

  // ── STEP 3: OTP tekshirish ────────────────────────────────────────────────
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
      await ctx.reply('⚠️ Kod 5-6 ta raqamdan iborat. Qayta kiriting:');
      return;
    }

    try {
      const { client, phoneCodeHash, phone } = pending;

      await client.invoke(
        new Api.auth.SignIn({
          phoneNumber: phone,
          phoneCodeHash,
          phoneCode: code
        })
      );

      await saveAccount(ctx, client, phone);
      return ctx.scene.leave();

    } catch (err) {
      console.error('[addAccount] signIn:', err.message);

      if (err.message.includes('SESSION_PASSWORD_NEEDED')) {
        await ctx.reply(
          '🔐 *2FA parol yoqilgan!*\n\nTelegram parolingizni kiriting:',
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
        await ctx.reply('❌ Kod muddati o\'tdi. Qayta boshlang.');
        return ctx.scene.leave();
      }

      pendingClients.delete(userId);
      await ctx.reply(`❌ Xatolik: ${err.message}`);
      return ctx.scene.leave();
    }
  },

  // ── STEP 4: 2FA parol ─────────────────────────────────────────────────────
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
      await ctx.reply('❌ Session topilmadi.');
      return ctx.scene.leave();
    }

    try {
      const { client, phone } = pending;

      await client.signInWithPassword(
        { apiId: API_ID, apiHash: API_HASH },
        {
          password: async () => password,
          onError: async (err) => { throw err; }
        }
      );

      await saveAccount(ctx, client, phone);
      return ctx.scene.leave();

    } catch (err) {
      console.error('[addAccount] 2FA:', err.message);
      if (err.message.includes('PASSWORD_HASH_INVALID')) {
        await ctx.reply('❌ Noto\'g\'ri parol! Qayta kiriting:');
        return;
      }
      pendingClients.delete(ctx.from.id);
      await ctx.reply(`❌ Xatolik: ${err.message}`);
      return ctx.scene.leave();
    }
  }
);

// ── Session saqlash ───────────────────────────────────────────────────────────
async function saveAccount(ctx, client, phone) {
  const userId = ctx.from.id;
  const sessionString = client.session.save();
  await client.disconnect();
  pendingClients.delete(userId);

  await Account.findOneAndUpdate(
    { userId, phone },
    { userId, phone, apiId: API_ID, apiHash: API_HASH, session: sessionString, isActive: true },
    { upsert: true, new: true }
  );

  await ctx.reply(
    '✅ *Akkaunt muvaffaqiyatli ulandi!*\n\n' +
    `📱 Telefon: \`${phone}\`\n` +
    '🟢 Holat: Faol',
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🏠 Bosh menyuga', 'main_menu')]
      ])
    }
  );
}

addAccountScene.action('cancel_add', async (ctx) => {
  await ctx.answerCbQuery();
  pendingClients.delete(ctx.from.id);
  await ctx.reply('❌ Bekor qilindi');
  return ctx.scene.leave();
});

module.exports = addAccountScene;

module.exports.getEffectiveTarif = getEffectiveTarif;
module.exports.ACCOUNT_LIMITS = ACCOUNT_LIMITS;
