const { Markup } = require('telegraf');
const Account = require('./Account');

// ─── Bot API 9.4 (2026-02-09): tugmalarga rang ───────────────────────────────
function styledButton(text, callback_data, style) {
  const btn = Markup.button.callback(text, callback_data);
  return style ? { ...btn, style } : btn;
}

async function profillarHandler(ctx) {
  const accounts = await Account.find({ userId: ctx.from.id });

  if (!accounts.length) {
    await ctx.reply(
      '👥 *Profillar*\n\n' +
      '❌ Hali hech qanday profil yo\'q.',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [styledButton('➕ Yangi profil qo\'shish', 'add_account', 'success')],
          [styledButton('⬅️ Orqaga', 'main_menu', 'danger')]
        ])
      }
    );
    return;
  }

  // Akkauntlar ro'yxati
  const buttons = accounts.map((acc) => [
    styledButton(
      `${acc.isActive ? '🟢' : '🔴'} ${acc.phone}`,
      `profile_detail_${acc._id}`,
      acc.isActive ? 'success' : 'danger'
    )
  ]);

  buttons.push([styledButton('➕ Yangi profil qo\'shish', 'add_account', 'success')]);
  buttons.push([styledButton('⬅️ Orqaga', 'main_menu', 'danger')]);

  await ctx.reply(
    '👥 *Profillar*\n\n' +
    `Jami: *${accounts.length}* ta akkaunt`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons)
    }
  );
}

// Profil detail
async function profileDetailAction(ctx) {
  await ctx.answerCbQuery();
  const id = ctx.callbackQuery.data.replace('profile_detail_', '');

  const acc = await Account.findOne({ _id: id, userId: ctx.from.id });
  if (!acc) {
    return ctx.reply('❌ Profil topilmadi');
  }

  await ctx.editMessageText(
    `👤 *Profil ma'lumotlari*\n\n` +
    `📱 Telefon: \`${acc.phone}\`\n` +
    `🟢 Holat: ${acc.isActive ? 'Faol' : 'Nofaol'}\n` +
    `📅 Qo'shilgan: ${acc.createdAt.toLocaleDateString('uz-UZ')}`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [
          styledButton(
            acc.isActive ? '🔴 O\'chirish' : '🟢 Yoqish',
            `profile_toggle_${acc._id}`,
            acc.isActive ? 'danger' : 'success'
          )
        ],
        [styledButton('🗑 O\'chirish', `profile_delete_${acc._id}`, 'danger')],
        [styledButton('⬅️ Orqaga', 'profillar_menu')]
      ])
    }
  );
}

// Profilni yoqish/o'chirish
async function profileToggleAction(ctx) {
  await ctx.answerCbQuery();
  const id = ctx.callbackQuery.data.replace('profile_toggle_', '');

  const acc = await Account.findOne({ _id: id, userId: ctx.from.id });
  if (!acc) return ctx.reply('❌ Topilmadi');

  acc.isActive = !acc.isActive;
  await acc.save();

  await ctx.answerCbQuery(
    acc.isActive ? '✅ Profil yoqildi!' : '🔴 Profil o\'chirildi!',
    { show_alert: true }
  );
  await profileDetailAction(ctx);
}

// Profilni o'chirish
async function profileDeleteAction(ctx) {
  await ctx.answerCbQuery();
  const id = ctx.callbackQuery.data.replace('profile_delete_', '');

  const deleted = await Account.findOneAndDelete({ _id: id, userId: ctx.from.id });
  if (!deleted) return ctx.answerCbQuery('❌ Topilmadi', { show_alert: true });
  await ctx.answerCbQuery('🗑 Profil o\'chirildi!', { show_alert: true });

  await ctx.editMessageText(
    '🗑 Profil muvaffaqiyatli o\'chirildi.',
    Markup.inlineKeyboard([
      [styledButton('⬅️ Profillarga qaytish', 'profillar_menu')]
    ])
  );
}

module.exports = {
  profillarHandler,
  profileDetailAction,
  profileToggleAction,
  profileDeleteAction
};
