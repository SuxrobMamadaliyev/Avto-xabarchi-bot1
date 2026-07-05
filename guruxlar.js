const { Markup } = require('telegraf');
const { Scenes } = require('telegraf');
const mongoose = require('mongoose');

// Group model (inline)
const groupSchema = new mongoose.Schema({
  userId:    { type: Number, required: true },
  groupId:   { type: String, required: true },
  groupName: { type: String, required: true },
  selected:  { type: Boolean, default: true },
  addedAt:   { type: Date, default: Date.now }
});
groupSchema.index({ userId: 1, groupId: 1 }, { unique: true });
const Group = mongoose.models.Group || mongoose.model('Group', groupSchema);

// User settings model uchun
const User = require('./User');

// ─── Guruhlarni sozlash asosiy menyu ────────────────────────────────────────
async function guruhlarHandler(ctx) {
  const user = await User.findOne({ userId: ctx.from.id });
  const groupMode = user?.groupMode || 'all'; // 'all' | 'selected'

  const groups = await Group.find({ userId: ctx.from.id });
  const selectedCount = groups.filter(g => g.selected).length;

  await ctx.reply(
    `🎯 *Guruhlarni sozlash*\n\n` +
    `Qaysi guruhlarga xabar yuboramiz?\n` +
    `✔️ Tanlangan\n` +
    `➕ Tanlanmagan\n\n` +
    `📌 Hozirgi tanlov: *${groupMode === 'all' ? 'Hamma guruhlarga' : `${selectedCount} ta tanlangan guruh`}*\n\n` +
    `🗂 Guruhlarni tanlang`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✔️ Hamma guruhlarga', 'group_mode_all')],
        [Markup.button.callback('➕ O\'zim tanlayman', 'group_mode_select')],
        [Markup.button.callback('⬅️ Orqaga', 'main_menu')]
      ])
    }
  );
}

// Hamma guruhlarga rejimi
async function groupModeAllAction(ctx) {
  await ctx.answerCbQuery();
  await User.findOneAndUpdate(
    { userId: ctx.from.id },
    { groupMode: 'all' },
    { upsert: true }
  );

  await ctx.editMessageText(
    `🎯 *Guruhlarni sozlash*\n\n` +
    `Qaysi guruhlarga xabar yuboramiz?\n` +
    `✔️ Tanlangan\n` +
    `➕ Tanlanmagan\n\n` +
    `📌 Hozirgi tanlov: *Hamma guruhlarga*\n\n` +
    `🗂 Guruhlarni tanlang`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✔️ Hamma guruhlarga', 'group_mode_all')],
        [Markup.button.callback('➕ O\'zim tanlayman', 'group_mode_select')],
        [Markup.button.callback('⬅️ Orqaga', 'main_menu')]
      ])
    }
  );
}

// O'zim tanlayman — guruhlar ro'yxati
async function groupModeSelectAction(ctx) {
  await ctx.answerCbQuery();
  await User.findOneAndUpdate(
    { userId: ctx.from.id },
    { groupMode: 'selected' },
    { upsert: true }
  );

  await showGroupList(ctx);
}

async function showGroupList(ctx) {
  const groups = await Group.find({ userId: ctx.from.id });

  if (!groups.length) {
    await ctx.reply(
      '📋 *Guruhlar ro\'yxati bo\'sh*\n\n' +
      'Guruh qo\'shish uchun botingizni guruhga admin qiling,\n' +
      'keyin bot avtomatik ro\'yxatga oladi.',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('➕ Guruh ID qo\'shish', 'add_group_manual')],
          [Markup.button.callback('⬅️ Orqaga', 'guruhlar_menu')]
        ])
      }
    );
    return;
  }

  const buttons = groups.map(g => [
    Markup.button.callback(
      `${g.selected ? '✔️' : '➕'} ${g.groupName}`,
      `toggle_group_${g._id}`
    )
  ]);

  buttons.push([Markup.button.callback('➕ Guruh qo\'shish', 'add_group_manual')]);
  buttons.push([Markup.button.callback('⬅️ Orqaga', 'guruhlar_menu')]);

  await ctx.reply(
    `📋 *Guruhlaringiz:*\n\n` +
    `✔️ — tanlangan (xabar yuboriladi)\n` +
    `➕ — tanlanmagan`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons)
    }
  );
}

// Guruhni tanlash/bekor qilish
async function toggleGroupAction(ctx) {
  await ctx.answerCbQuery();
  const id = ctx.callbackQuery.data.replace('toggle_group_', '');

  const group = await Group.findById(id);
  if (!group) return;

  group.selected = !group.selected;
  await group.save();

  await ctx.answerCbQuery(
    group.selected ? '✅ Guruh tanlandi' : '❌ Guruh bekor qilindi',
    { show_alert: false }
  );

  // Ro'yxatni yangilash
  const groups = await Group.find({ userId: ctx.from.id });
  const buttons = groups.map(g => [
    Markup.button.callback(
      `${g.selected ? '✔️' : '➕'} ${g.groupName}`,
      `toggle_group_${g._id}`
    )
  ]);
  buttons.push([Markup.button.callback('➕ Guruh qo\'shish', 'add_group_manual')]);
  buttons.push([Markup.button.callback('⬅️ Orqaga', 'guruhlar_menu')]);

  await ctx.editMessageReplyMarkup(
    Markup.inlineKeyboard(buttons).reply_markup
  );
}

// Guruh qo'shish scene (qo'lda ID kiritish)
const addGroupScene = new Scenes.WizardScene(
  'ADD_GROUP',

  async (ctx) => {
    await ctx.reply(
      '➕ *Guruh ID kiriting:*\n\n' +
      'Guruh ID ni olish uchun:\n' +
      '1. Botni guruhga qo\'shing\n' +
      '2. Guruhda `/id` yozing\n\n' +
      'Yoki guruh username: `@guruhusername`',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('❌ Bekor qilish', 'cancel_add_group')]
        ])
      }
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (ctx.callbackQuery?.data === 'cancel_add_group') {
      await ctx.answerCbQuery();
      await ctx.scene.leave();
      return;
    }

    const input = ctx.message?.text?.trim();
    if (!input) return;

    const groupId = input.startsWith('@') ? input : input;
    const groupName = input.startsWith('@') ? input : `Guruh ${input}`;

    try {
      await Group.findOneAndUpdate(
        { userId: ctx.from.id, groupId },
        { userId: ctx.from.id, groupId, groupName, selected: true },
        { upsert: true, new: true }
      );

      await ctx.reply(`✅ *${groupName}* qo'shildi!`, { parse_mode: 'Markdown' });
      await ctx.scene.leave();
      await showGroupList(ctx);
    } catch (err) {
      await ctx.reply('❌ Xatolik. Qayta kiriting:');
    }
  }
);

addGroupScene.action('cancel_add_group', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.scene.leave();
});

// Bot guruhga qo'shilganda avtomatik saqlash
async function onBotAddedToGroup(ctx) {
  if (!ctx.chat || !['group', 'supergroup'].includes(ctx.chat.type)) return;

  const admins = await ctx.telegram.getChatAdministrators(ctx.chat.id);
  const isAdmin = admins.some(a => a.user.id === ctx.botInfo.id);
  if (!isAdmin) return;

  // Guruhni barcha adminlar uchun saqlash
  for (const admin of admins) {
    if (admin.user.is_bot) continue;
    try {
      await Group.findOneAndUpdate(
        { userId: admin.user.id, groupId: String(ctx.chat.id) },
        {
          userId: admin.user.id,
          groupId: String(ctx.chat.id),
          groupName: ctx.chat.title || 'Noma\'lum guruh',
          selected: true
        },
        { upsert: true }
      );
    } catch {}
  }
}

module.exports = {
  guruhlarHandler,
  groupModeAllAction,
  groupModeSelectAction,
  toggleGroupAction,
  addGroupScene,
  onBotAddedToGroup,
  Group
};
