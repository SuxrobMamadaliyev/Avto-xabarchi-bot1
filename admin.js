const { Scenes } = require('telegraf');
const { iBtn, rawInline } = require('./styledKb');
const User    = require('./User');
const Account = require('./Account');
const { joinAllAccountsToGroup } = require('./groupJoiner');

// ─── Adminlar ro'yxati (.env dagi ADMIN_IDS, vergul bilan ajratilgan) ────────
const ADMIN_IDS = (process.env.ADMIN_IDS || '')
  .split(',')
  .map(id => parseInt(id.trim(), 10))
  .filter(Boolean);

function isAdmin(userId) {
  return ADMIN_IDS.includes(Number(userId));
}

// ─── Admin panel bosh menyu ───────────────────────────────────────────────────
async function adminPanelHandler(ctx) {
  if (!isAdmin(ctx.from.id)) return;

  await ctx.reply(
    `🛠 *Admin panel*\n\n👋 Xush kelibsiz, admin!`,
    {
      parse_mode: 'Markdown',
      ...rawInline([
        [iBtn('📊 Statistika', 'admin_stats', 'primary')],
        [iBtn('➕ Akkauntlarni gurux/kanalga qo\'shish', 'admin_join_group', 'success')],
        [iBtn('📢 Foydalanuvchilarga xabar yuborish', 'admin_broadcast', 'primary')],
        [iBtn('⚫️ Yopish', 'admin_close')]
      ])
    }
  );
}

// ─── Statistika ───────────────────────────────────────────────────────────────
async function adminStatsAction(ctx) {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery();
  await ctx.answerCbQuery('⏳ Yuklanmoqda...');

  const [userCount, accountCount, runningUsers, users] = await Promise.all([
    User.countDocuments(),
    Account.countDocuments({ isActive: true }),
    User.countDocuments({ isRunning: true }),
    User.find({}, 'totalSentCount referralCount').lean()
  ]);

  const totalSent   = users.reduce((sum, u) => sum + (u.totalSentCount || 0), 0);
  const totalRefs   = users.reduce((sum, u) => sum + (u.referralCount || 0), 0);

  const text =
    `📊 *Bot statistikasi*\n` +
    `${'━'.repeat(18)}\n\n` +
    `👥 Foydalanuvchilar: *${userCount}*\n` +
    `📱 Ulangan akkauntlar: *${accountCount}*\n` +
    `🟢 Hozir ishlayotgan: *${runningUsers}*\n` +
    `🔁 Jami yuborilgan habarlar: *${totalSent}*\n` +
    `🎁 Jami referallar: *${totalRefs}*\n` +
    `${'━'.repeat(18)}`;

  const kb = rawInline([
    [iBtn('🔄 Yangilash', 'admin_stats', 'primary')],
    [iBtn('⬅️ Orqaga', 'admin_panel')]
  ]);

  try { await ctx.editMessageText(text, { parse_mode: 'Markdown', ...kb }); }
  catch { await ctx.reply(text, { parse_mode: 'Markdown', ...kb }); }
}

// ─── Akkauntlarni gurux/kanalga qo'shish (WizardScene) ───────────────────────
const adminJoinGroupScene = new Scenes.WizardScene(
  'ADMIN_JOIN_GROUP',

  async (ctx) => {
    if (!isAdmin(ctx.from.id)) { return ctx.scene.leave(); }

    const accCount = await Account.countDocuments({ isActive: true });
    await ctx.reply(
      `➕ *Akkauntlarni gurux/kanalga qo'shish*\n\n` +
      `Botga ulangan barcha akkauntlar (${accCount} ta) tanlangan gurux yoki kanalga qo'shiladi.\n\n` +
      `👇 Gurux/kanal username'ini (\`@nomi\`) yoki taklif havolasini yuboring:`,
      {
        parse_mode: 'Markdown',
        ...rawInline([[iBtn('❌ Bekor qilish', 'cancel_admin', 'danger')]])
      }
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (ctx.callbackQuery?.data === 'cancel_admin') {
      await ctx.answerCbQuery();
      await ctx.scene.leave();
      return adminPanelHandler(ctx);
    }

    const target = ctx.message?.text?.trim();
    if (!target) {
      await ctx.reply('⚠️ Iltimos, gurux/kanal username yoki havolasini yuboring:');
      return;
    }

    const accCount = await Account.countDocuments({ isActive: true });
    if (!accCount) {
      await ctx.reply('⚠️ Botga ulangan hech qanday akkaunt topilmadi.');
      await ctx.scene.leave();
      return adminPanelHandler(ctx);
    }

    const progressMsg = await ctx.reply(`⏳ 0/${accCount} akkaunt qo'shildi...`);

    let lastEdit = 0;
    const result = await joinAllAccountsToGroup(target, async ({ done, total, success, failed }) => {
      const now = Date.now();
      if (now - lastEdit < 2000 && done < total) return; // tez-tez tahrirlamaslik uchun
      lastEdit = now;
      try {
        await ctx.telegram.editMessageText(
          progressMsg.chat.id, progressMsg.message_id, undefined,
          `⏳ ${done}/${total} akkaunt qo'shildi... (✅ ${success} | ❌ ${failed})`
        );
      } catch {}
    });

    const failedList = result.results
      .filter(r => !r.ok)
      .slice(0, 10)
      .map(r => `• \`${r.phone}\` — ${r.error?.slice(0, 60) || 'xato'}`)
      .join('\n');

    await ctx.reply(
      `✅ *Yakunlandi!*\n\n` +
      `📦 Jami: ${result.total} ta akkaunt\n` +
      `✅ Muvaffaqiyatli: ${result.success} ta\n` +
      `❌ Xato: ${result.failed} ta` +
      (failedList ? `\n\n*Xatolar:*\n${failedList}` : ''),
      { parse_mode: 'Markdown' }
    );

    await ctx.scene.leave();
    return adminPanelHandler(ctx);
  }
);

adminJoinGroupScene.action('cancel_admin', async (ctx) => { await ctx.answerCbQuery(); await ctx.scene.leave(); });

// ─── Foydalanuvchilarga umumiy xabar yuborish (WizardScene) ──────────────────
const adminBroadcastScene = new Scenes.WizardScene(
  'ADMIN_BROADCAST',

  async (ctx) => {
    if (!isAdmin(ctx.from.id)) { return ctx.scene.leave(); }

    await ctx.reply(
      '📢 *Xabar yuborish*\n\nBarcha foydalanuvchilarga yuboriladigan xabar matnini kiriting:',
      {
        parse_mode: 'Markdown',
        ...rawInline([[iBtn('❌ Bekor qilish', 'cancel_admin', 'danger')]])
      }
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (ctx.callbackQuery?.data === 'cancel_admin') {
      await ctx.answerCbQuery();
      await ctx.scene.leave();
      return adminPanelHandler(ctx);
    }

    const text = ctx.message?.text?.trim();
    if (!text) {
      await ctx.reply('⚠️ Iltimos, matn kiriting:');
      return;
    }

    const users = await User.find({}, 'userId').lean();
    const progressMsg = await ctx.reply(`⏳ 0/${users.length} yuborildi...`);

    let sent = 0, failed = 0;
    for (const u of users) {
      try {
        await ctx.telegram.sendMessage(u.userId, text);
        sent++;
      } catch {
        failed++;
      }
      if ((sent + failed) % 20 === 0) {
        try {
          await ctx.telegram.editMessageText(
            progressMsg.chat.id, progressMsg.message_id, undefined,
            `⏳ ${sent + failed}/${users.length} yuborildi... (✅ ${sent} | ❌ ${failed})`
          );
        } catch {}
      }
      await new Promise(r => setTimeout(r, 50)); // Telegram flood-limit himoyasi
    }

    await ctx.reply(
      `✅ *Xabar yuborish yakunlandi!*\n\n✅ Yuborildi: ${sent}\n❌ Xato: ${failed}`,
      { parse_mode: 'Markdown' }
    );
    await ctx.scene.leave();
    return adminPanelHandler(ctx);
  }
);

adminBroadcastScene.action('cancel_admin', async (ctx) => { await ctx.answerCbQuery(); await ctx.scene.leave(); });

module.exports = {
  isAdmin,
  adminPanelHandler,
  adminStatsAction,
  adminJoinGroupScene,
  adminBroadcastScene
};
