const { Scenes } = require('telegraf');
const { iBtn, rawInline } = require('./styledKb');
const mongoose = require('mongoose');

const msgSchema = new mongoose.Schema({
  userId:       { type: Number, required: true, unique: true },
  type:         { type: String, default: 'text' },
  text:         { type: String },
  photoId:      { type: String },
  buttons:      { type: Array, default: [] },
  variants:     { type: Array, default: [] }, // 'multi' turi uchun: [{ text, photoId }]
  variantIndex: { type: Number, default: 0 },
  updatedAt:    { type: Date, default: Date.now }
});
const MsgSettings = mongoose.models.MsgSettings || mongoose.model('MsgSettings', msgSchema);

// ─── Habarni sozlash menyu ────────────────────────────────────────────────────
async function habarMatniHandler(ctx) {
  const msg = await MsgSettings.findOne({ userId: ctx.from.id });

  const typeLabel = {
    text:    '📝 Matn',
    photo:   '🖼 Rasm+matn',
    button:  '🔘 Tugmali habar',
    forward: '➡️ Forward',
    multi:   '📋 Turli habarlar'
  };

  const currentDesc = msg?.type === 'multi'
    ? `${msg.variants?.length || 0} ta xabar navbat bilan`
    : (msg?.text ? msg.text.slice(0, 30) + (msg.text.length > 30 ? '...' : '') : 'Sozlanmagan');

  await ctx.reply(
    `👾 *Habarni sozlash*\n\n` +
    `Joriy tur: ${typeLabel[msg?.type || 'text']}\n` +
    `Xabar:     ${currentDesc}\n\n` +
    `👇 Xabar turini tanlang:`,
    {
      parse_mode: 'Markdown',
      ...rawInline([
        [iBtn('📝 Matn',              'msg_type_text',           'primary')],
        [iBtn('🖼 Rasm+matn',         'msg_type_photo',          'primary')],
        [iBtn('➡️ Forward',          'msg_type_forward',        'primary')],
        [iBtn('🔘 Tugmali habar',     'msg_type_button',         'primary')],
        [iBtn('📋 Turli habarlar',    'msg_type_multi',          'primary')],
        [iBtn('⬅️ Orqaga',           'main_menu')]
      ])
    }
  );
}

// ─── MATN SCENE ──────────────────────────────────────────────────────────────
const textMsgScene = new Scenes.WizardScene(
  'TEXT_MSG',

  async (ctx) => {
    const msg = await MsgSettings.findOne({ userId: ctx.from.id });

    await ctx.reply(
      '📝 *Xabar matnini kiriting:*\n\n' +
      (msg?.text ? `Joriy matn:\n_${msg.text}_\n\n` : '') +
      'HTML teglari ishlatishingiz mumkin:\n' +
      '<b>qalin</b>, <i>kursiv</i>, <code>kod</code>',
      {
        parse_mode: 'Markdown',
        ...rawInline([[iBtn('❌ Bekor qilish', 'cancel_msg', 'danger')]])
      }
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (ctx.callbackQuery?.data === 'cancel_msg') {
      await ctx.answerCbQuery();
      await ctx.scene.leave();
      return habarMatniHandler(ctx);
    }

    const text = ctx.message?.text?.trim();
    if (!text) {
      await ctx.reply('⚠️ Matn bo\'sh bo\'lishi mumkin emas!');
      return;
    }

    await MsgSettings.findOneAndUpdate(
      { userId: ctx.from.id },
      { userId: ctx.from.id, type: 'text', text, updatedAt: new Date() },
      { upsert: true }
    );

    await ctx.reply(
      '✅ *Xabar matni saqlandi!*\n\n' +
      `📝 Matn: _${text.slice(0, 50)}${text.length > 50 ? '...' : ''}_`,
      { parse_mode: 'Markdown' }
    );
    await ctx.scene.leave();
    return habarMatniHandler(ctx);
  }
);

textMsgScene.action('cancel_msg', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.scene.leave();
});

// ─── RASM+MATN SCENE ─────────────────────────────────────────────────────────
const photoMsgScene = new Scenes.WizardScene(
  'PHOTO_MSG',

  async (ctx) => {
    await ctx.reply(
      '🖼 *Rasm yuboring:*\n\n' +
      'Rasmni yuborishdan oldin caption (izoh) ham qo\'shishingiz mumkin.',
      {
        parse_mode: 'Markdown',
        ...rawInline([[iBtn('❌ Bekor qilish', 'cancel_msg', 'danger')]])
      }
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (ctx.callbackQuery?.data === 'cancel_msg') {
      await ctx.answerCbQuery();
      await ctx.scene.leave();
      return habarMatniHandler(ctx);
    }

    if (!ctx.message?.photo) {
      await ctx.reply('⚠️ Iltimos, rasm yuboring:');
      return;
    }

    const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    const caption = ctx.message.caption || '';

    ctx.wizard.state.photoId = photoId;
    ctx.wizard.state.text = caption;

    await ctx.reply(
      '✍️ *Rasm uchun matn kiriting:*\n\n' +
      '_(Matn bo\'lmasa "o\'tkazib yuborish" tugmasini bosing)_',
      {
        parse_mode: 'Markdown',
        ...rawInline([
          [iBtn('⏭ O\'tkazib yuborish', 'skip_caption', 'primary')],
          [iBtn('❌ Bekor qilish',      'cancel_msg',    'danger')]
        ])
      }
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (ctx.callbackQuery?.data === 'cancel_msg') {
      await ctx.answerCbQuery();
      await ctx.scene.leave();
      return habarMatniHandler(ctx);
    }

    let text = '';
    if (ctx.callbackQuery?.data === 'skip_caption') {
      await ctx.answerCbQuery();
      text = ctx.wizard.state.text || '';
    } else {
      text = ctx.message?.text?.trim() || ctx.wizard.state.text || '';
    }

    const { photoId } = ctx.wizard.state;

    await MsgSettings.findOneAndUpdate(
      { userId: ctx.from.id },
      { userId: ctx.from.id, type: 'photo', photoId, text, updatedAt: new Date() },
      { upsert: true }
    );

    await ctx.reply('✅ *Rasm+matn saqlandi!*', { parse_mode: 'Markdown' });
    await ctx.scene.leave();
    return habarMatniHandler(ctx);
  }
);

photoMsgScene.action('skip_caption', async (ctx) => { await ctx.answerCbQuery(); });
photoMsgScene.action('cancel_msg',   async (ctx) => { await ctx.answerCbQuery(); await ctx.scene.leave(); });

// ─── TUGMALI HABAR SCENE ─────────────────────────────────────────────────────
const buttonMsgScene = new Scenes.WizardScene(
  'BUTTON_MSG',

  async (ctx) => {
    await ctx.reply(
      '🔘 *Tugmali habar*\n\n' +
      'Xabar matnini kiriting:',
      {
        parse_mode: 'Markdown',
        ...rawInline([[iBtn('❌ Bekor qilish', 'cancel_msg', 'danger')]])
      }
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (ctx.callbackQuery?.data === 'cancel_msg') {
      await ctx.answerCbQuery();
      await ctx.scene.leave();
      return habarMatniHandler(ctx);
    }

    const text = ctx.message?.text?.trim();
    if (!text) {
      await ctx.reply('⚠️ Matn kiriting:');
      return;
    }

    ctx.wizard.state.text = text;
    await ctx.reply(
      '🔗 *Tugma qo\'shing:*\n\n' +
      'Formatda yozing:\n' +
      '`Tugma nomi | https://link.com`\n\n' +
      'Bir necha tugma uchun har birini yangi qatorga yozing.',
      {
        parse_mode: 'Markdown',
        ...rawInline([
          [iBtn('⏭ Tugsiz saqlash', 'save_no_buttons', 'primary')],
          [iBtn('❌ Bekor qilish',   'cancel_msg',       'danger')]
        ])
      }
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (ctx.callbackQuery?.data === 'cancel_msg') {
      await ctx.answerCbQuery();
      await ctx.scene.leave();
      return habarMatniHandler(ctx);
    }

    let buttons = [];

    if (ctx.callbackQuery?.data === 'save_no_buttons') {
      await ctx.answerCbQuery();
    } else {
      const lines = ctx.message?.text?.split('\n') || [];
      for (const line of lines) {
        const [name, url] = line.split('|').map(s => s.trim());
        if (name && url && url.startsWith('http')) {
          buttons.push({ name, url });
        }
      }
    }

    const { text } = ctx.wizard.state;

    await MsgSettings.findOneAndUpdate(
      { userId: ctx.from.id },
      { userId: ctx.from.id, type: 'button', text, buttons, updatedAt: new Date() },
      { upsert: true }
    );

    await ctx.reply(
      `✅ *Tugmali habar saqlandi!*\n\n` +
      `📝 Matn: _${text.slice(0, 40)}_\n` +
      `🔘 Tugmalar: ${buttons.length} ta`,
      { parse_mode: 'Markdown' }
    );
    await ctx.scene.leave();
    return habarMatniHandler(ctx);
  }
);

buttonMsgScene.action('save_no_buttons', async (ctx) => { await ctx.answerCbQuery(); });
buttonMsgScene.action('cancel_msg',      async (ctx) => { await ctx.answerCbQuery(); await ctx.scene.leave(); });

// ─── FORWARD SCENE ───────────────────────────────────────────────────────────
// Foydalanuvchi istalgan xabarni (matn yoki rasm) botga forward qiladi/yuboradi,
// bot uni saqlab, keyin guruhlarga shu tarzda avtomatik yuboradi.
const forwardMsgScene = new Scenes.WizardScene(
  'FORWARD_MSG',

  async (ctx) => {
    await ctx.reply(
      '➡️ *Forward xabar*\n\n' +
      'Istalgan kanal/guruhdagi xabarni botga forward qiling ' +
      '(yoki shunchaki matn/rasm yuboring) — u aynan shu holatda guruhlarga yuboriladi.',
      {
        parse_mode: 'Markdown',
        ...rawInline([[iBtn('❌ Bekor qilish', 'cancel_msg', 'danger')]])
      }
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (ctx.callbackQuery?.data === 'cancel_msg') {
      await ctx.answerCbQuery();
      await ctx.scene.leave();
      return habarMatniHandler(ctx);
    }

    const text  = ctx.message?.text?.trim() || ctx.message?.caption?.trim() || '';
    const photo = ctx.message?.photo;
    const photoId = photo ? photo[photo.length - 1].file_id : undefined;

    if (!text && !photoId) {
      await ctx.reply('⚠️ Iltimos, matn yoki rasm (forward) yuboring:');
      return;
    }

    await MsgSettings.findOneAndUpdate(
      { userId: ctx.from.id },
      {
        userId: ctx.from.id,
        type: 'forward',
        text,
        photoId: photoId || undefined,
        updatedAt: new Date()
      },
      { upsert: true }
    );

    await ctx.reply('✅ *Forward xabar saqlandi!*', { parse_mode: 'Markdown' });
    await ctx.scene.leave();
    return habarMatniHandler(ctx);
  }
);

forwardMsgScene.action('cancel_msg', async (ctx) => { await ctx.answerCbQuery(); await ctx.scene.leave(); });

// ─── TURLI HABARLAR (MULTI) SCENE ────────────────────────────────────────────
// Foydalanuvchi 2-4 ta turli xabar (matn yoki rasm+matn) kiritadi, autohabar
// har safar navbat bilan boshqa variantni yuboradi.
const MULTI_MIN = 2;
const MULTI_MAX = 4;

const multiMsgScene = new Scenes.WizardScene(
  'MULTI_MSG',

  async (ctx) => {
    ctx.wizard.state.variants = [];
    await ctx.reply(
      `📋 *Turli habarlar*\n\n` +
      `Navbat bilan yuboriladigan ${MULTI_MIN}-${MULTI_MAX} ta xabar kiriting.\n` +
      `Har biri matn yoki rasm+matn bo'lishi mumkin.\n\n` +
      `1-xabarni yuboring:`,
      {
        parse_mode: 'Markdown',
        ...rawInline([[iBtn('❌ Bekor qilish', 'cancel_msg', 'danger')]])
      }
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (ctx.callbackQuery?.data === 'cancel_msg') {
      await ctx.answerCbQuery();
      await ctx.scene.leave();
      return habarMatniHandler(ctx);
    }

    if (ctx.callbackQuery?.data === 'multi_done') {
      await ctx.answerCbQuery();
      const variants = ctx.wizard.state.variants || [];
      if (variants.length < MULTI_MIN) {
        return ctx.answerCbQuery(`⚠️ Kamida ${MULTI_MIN} ta xabar kerak!`, { show_alert: true });
      }

      await MsgSettings.findOneAndUpdate(
        { userId: ctx.from.id },
        {
          userId: ctx.from.id,
          type: 'multi',
          variants,
          variantIndex: 0,
          text: variants[0]?.text || '',
          photoId: variants[0]?.photoId,
          updatedAt: new Date()
        },
        { upsert: true }
      );

      await ctx.reply(`✅ *${variants.length} ta xabar saqlandi!* Navbat bilan yuboriladi.`, { parse_mode: 'Markdown' });
      await ctx.scene.leave();
      return habarMatniHandler(ctx);
    }

    const text  = ctx.message?.text?.trim() || ctx.message?.caption?.trim() || '';
    const photo = ctx.message?.photo;
    const photoId = photo ? photo[photo.length - 1].file_id : undefined;

    if (!text && !photoId) {
      await ctx.reply('⚠️ Matn yoki rasm yuboring:');
      return;
    }

    ctx.wizard.state.variants.push({ text, photoId });
    const count = ctx.wizard.state.variants.length;

    if (count >= MULTI_MAX) {
      const variants = ctx.wizard.state.variants;
      await MsgSettings.findOneAndUpdate(
        { userId: ctx.from.id },
        {
          userId: ctx.from.id,
          type: 'multi',
          variants,
          variantIndex: 0,
          text: variants[0]?.text || '',
          photoId: variants[0]?.photoId,
          updatedAt: new Date()
        },
        { upsert: true }
      );
      await ctx.reply(`✅ *${variants.length} ta xabar saqlandi!* Navbat bilan yuboriladi.`, { parse_mode: 'Markdown' });
      await ctx.scene.leave();
      return habarMatniHandler(ctx);
    }

    await ctx.reply(
      `✅ ${count}-xabar qabul qilindi.\n\n${count + 1}-xabarni yuboring ` +
      `(yoki tugatish uchun tugmani bosing):`,
      {
        ...rawInline([
          ...(count >= MULTI_MIN ? [[iBtn('✅ Tugatish', 'multi_done', 'success')]] : []),
          [iBtn('❌ Bekor qilish', 'cancel_msg', 'danger')]
        ])
      }
    );
  }
);

multiMsgScene.action('cancel_msg', async (ctx) => { await ctx.answerCbQuery(); await ctx.scene.leave(); });
multiMsgScene.action('multi_done', async (ctx) => {}); // handled inline above (falls through to wizard step)

module.exports = {
  habarMatniHandler,
  textMsgScene,
  photoMsgScene,
  buttonMsgScene,
  forwardMsgScene,
  multiMsgScene,
  MsgSettings
};
