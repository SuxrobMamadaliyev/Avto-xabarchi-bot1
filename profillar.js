const { iBtn, rawInline } = require('./styledKb');
const Account = require('./Account');

async function profillarHandler(ctx) {
  const accounts = await Account.find({ userId: ctx.from.id });

  if (!accounts.length) {
    await ctx.reply(
      '👥 *Profillar*\n\n' +
      '❌ Hali hech qanday profil yo\'q.',
      {
        parse_mode: 'Markdown',
        ...rawInline([
          [iBtn('➕ Yangi profil qo\'shish', 'add_account', 'success')],
          [iBtn('⬅️ Orqaga',               'main_menu',    'danger')]
        ])
      }
    );
    return;
  }

  const rows = accounts.map((acc) => [
    iBtn(
      `${acc.isActive ? '🟢' : '🔴'} ${acc.phone}`,
      `profile_detail_${acc._id}`,
      acc.isActive ? 'success' : 'danger'
    )
  ]);

  rows.push([iBtn('➕ Yangi profil qo\'shish', 'add_account', 'success')]);
  rows.push([iBtn('⬅️ Orqaga',               'main_menu',    'danger')]);

  await ctx.reply(
    '👥 *Profillar*\n\n' +
    `Jami: *${accounts.length}* ta akkaunt`,
    {
      parse_mode: 'Markdown',
      ...rawInline(rows)
    }
  );
}

async function profileDetailAction(ctx) {
  await ctx.answerCbQuery();
  const id = ctx.callbackQuery.data.replace('profile_detail_', '');

  const acc = await Account.findOne({ _id: id, userId: ctx.from.id });
  if (!acc) return ctx.reply('❌ Profil topilmadi');

  await ctx.editMessageText(
    `👤 *Profil ma'lumotlari*\n\n` +
    `📱 Telefon: \`${acc.phone}\`\n` +
    `🟢 Holat: ${acc.isActive ? 'Faol' : 'Nofaol'}\n` +
    `📅 Qo'shilgan: ${acc.createdAt.toLocaleDateString('uz-UZ')}`,
    {
      parse_mode: 'Markdown',
      ...rawInline([
        [
          iBtn(
            acc.isActive ? '🔴 O\'chirish' : '🟢 Yoqish',
            `profile_toggle_${acc._id}`,
            acc.isActive ? 'danger' : 'success'
          )
        ],
        [iBtn('🗑 O\'chirish', `profile_delete_${acc._id}`, 'danger')],
        [iBtn('⬅️ Orqaga',   'profillar_menu')]
      ])
    }
  );
}

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

async function profileDeleteAction(ctx) {
  await ctx.answerCbQuery();
  const id = ctx.callbackQuery.data.replace('profile_delete_', '');

  const deleted = await Account.findOneAndDelete({ _id: id, userId: ctx.from.id });
  if (!deleted) return ctx.answerCbQuery('❌ Topilmadi', { show_alert: true });
  await ctx.answerCbQuery('🗑 Profil o\'chirildi!', { show_alert: true });

  await ctx.editMessageText(
    '🗑 Profil muvaffaqiyatli o\'chirildi.',
    rawInline([[iBtn('⬅️ Profillarga qaytish', 'profillar_menu', 'primary')]])
  );
}

module.exports = {
  profillarHandler,
  profileDetailAction,
  profileToggleAction,
  profileDeleteAction
};
