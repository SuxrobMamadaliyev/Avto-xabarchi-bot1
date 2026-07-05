const { Markup } = require('telegraf');
const Account = require('./Account');

async function profillarHandler(ctx) {
  const accounts = await Account.find({ userId: ctx.from.id });

  if (!accounts.length) {
    await ctx.reply(
      '👥 *Profillar*\n\n' +
      '❌ Hali hech qanday profil yo\'q.',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('➕ Yangi profil qo\'shish', 'add_account')],
          [Markup.button.callback('⬅️ Orqaga', 'main_menu')]
        ])
      }
    );
    return;
  }

  // Akkauntlar ro'yxati
  const buttons = accounts.map((acc, i) => [
    Markup.button.callback(
      `${acc.isActive ? '🟢' : '🔴'} ${acc.phone}`,
      `profile_detail_${acc._id}`
    )
  ]);

  buttons.push([Markup.button.callback('➕ Yangi profil qo\'shish', 'add_account')]);
  buttons.push([Markup.button.callback('⬅️ Orqaga', 'main_menu')]);

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

  const acc = await Account.findById(id);
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
          Markup.button.callback(
            acc.isActive ? '🔴 O\'chirish' : '🟢 Yoqish',
            `profile_toggle_${acc._id}`
          )
        ],
        [Markup.button.callback('🗑 O\'chirish', `profile_delete_${acc._id}`)],
        [Markup.button.callback('⬅️ Orqaga', 'profillar_menu')]
      ])
    }
  );
}

// Profilni yoqish/o'chirish
async function profileToggleAction(ctx) {
  await ctx.answerCbQuery();
  const id = ctx.callbackQuery.data.replace('profile_toggle_', '');

  const acc = await Account.findById(id);
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

  await Account.findByIdAndDelete(id);
  await ctx.answerCbQuery('🗑 Profil o\'chirildi!', { show_alert: true });

  // Profillar ro'yxatiga qaytish
  await ctx.editMessageText(
    '🗑 Profil muvaffaqiyatli o\'chirildi.',
    Markup.inlineKeyboard([
      [Markup.button.callback('⬅️ Profillarga qaytish', 'profillar_menu')]
    ])
  );
}

module.exports = {
  profillarHandler,
  profileDetailAction,
  profileToggleAction,
  profileDeleteAction
};
