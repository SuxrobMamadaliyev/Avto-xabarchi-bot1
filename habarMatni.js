const { Scenes } = require('telegraf');
const { iBtn, rawInline } = require('./styledKb');
const mongoose = require('mongoose');

const msgSchema = new mongoose.Schema({
  userId:    { type: Number, required: true, unique: true },
  type:      { type: String, default: 'text' },
  text:      { type: String },
  photoId:   { type: String },
  buttons:   { type: Array, default: [] },
  updatedAt: { type: Date, default: Date.now }
});
const MsgSettings = mongoose.models.MsgSettings || mongoose.model('MsgSettings', msgSchema);

// ─── Habarni sozlash menyu ────────────────────────────────────────────────────
async function habarMatniHandler(ctx) {
  const msg = await MsgSettings.findOne({ userId: ctx.from.id });

  const typeLabel = {
    text:   '📝 Matn',
    photo:  '🖼 Rasm+matn',
    button: '🔘 Tugmali habar'
  };

  await ctx.reply(
    `👾 *Habarni sozlash*\n\n` +
    `Joriy tur: ${typeLabel[msg?.type || 'text']}\n` +
    `Xabar:     ${msg?.text ? msg.text.slice(0, 30) + (msg.text.length > 30 ? '...' : '') : 'Sozlanmagan'}\n\n` +
    `👇 Xabar turini tanlang:`,
    {
      parse_mode: 'Markdown',
      ...rawInline([
        [iBtn('📝 Matn',              'msg_type_text',           'primary')],
        [iBtn('🖼 Rasm+matn',         'msg_type_photo',          'primary')],
        [iBtn('🔘 Tugmali habar',     'msg_type_button',         'primary')],
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

module.exports = {
  habarMatniHandler,
  textMsgScene,
  photoMsgScene,
  buttonMsgScene,
  MsgSettings
};
