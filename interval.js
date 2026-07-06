const { Scenes } = require('telegraf');
const { iBtn, rawInline } = require('./styledKb');
const User = require('./User');

const INTERVALS = [
  { label: '2daq',     value: 120 },
  { label: '3daq',     value: 180 },
  { label: '4daq',     value: 240 },
  { label: '5daq',     value: 300 },
  { label: '6daq',     value: 360 },
  { label: '7daq',     value: 420 },
  { label: '8daq',     value: 480 },
  { label: '9daq',     value: 540 },
  { label: '10daq',    value: 600 },
  { label: '11daq',    value: 660 },
  { label: '12daq',    value: 720 },
  { label: '13daq',    value: 780 },
  { label: '14daq',    value: 840 },
  { label: '15daq',    value: 900 },
  { label: '30daq',    value: 1800 },
  { label: '1 soat',   value: 3600 },
  { label: '1.5 soat', value: 5400 },
  { label: '2 soat',   value: 7200 },
  { label: '3 soat',   value: 10800 },
];

function formatInterval(seconds) {
  if (seconds < 3600) return `${seconds / 60} daqiqa`;
  return `${seconds / 3600} soat`;
}

function buildIntervalKeyboard(currentInterval) {
  const rows = [];

  // Har bir interval tugmasiga rang: tanlangan = success, qolganlar = primary
  function mkRow(slice) {
    return slice.map(i =>
      iBtn(
        (i.value === currentInterval ? '✔️ ' : '') + i.label,
        `set_interval_${i.value}`,
        i.value === currentInterval ? 'success' : 'primary'
      )
    );
  }

  rows.push(mkRow(INTERVALS.slice(0, 5)));   // 2-6 daqiqa
  rows.push(mkRow(INTERVALS.slice(5, 10)));  // 7-11 daqiqa
  rows.push(mkRow(INTERVALS.slice(10, 14))); // 12-15 daqiqa
  rows.push(mkRow(INTERVALS.slice(14)));     // 30daq – 3soat

  rows.push([iBtn('❕ Interval nima', 'interval_info', 'primary')]);
  rows.push([iBtn('✍️ Qo\'lda kiritish', 'interval_manual', 'primary')]);
  rows.push([iBtn('⬅️ Orqaga', 'main_menu')]);

  return rawInline(rows);
}

async function intervalHandler(ctx) {
  const user = await User.findOne({ userId: ctx.from.id });
  const current = user?.interval || 300;

  await ctx.reply(
    `⏱ *Habar oraligi*\n\n` +
    `Joriy interval: *${formatInterval(current)}*\n\n` +
    `Kerakli vaqtni tanlang:`,
    {
      parse_mode: 'Markdown',
      ...buildIntervalKeyboard(current)
    }
  );
}

async function setIntervalAction(ctx) {
  await ctx.answerCbQuery();
  const value = parseInt(ctx.callbackQuery.data.replace('set_interval_', ''));

  await User.findOneAndUpdate(
    { userId: ctx.from.id },
    { interval: value },
    { upsert: true }
  );

  await ctx.editMessageText(
    `⏱ *Habar oraligi*\n\n` +
    `Joriy interval: *${formatInterval(value)}*\n\n` +
    `Kerakli vaqtni tanlang:`,
    {
      parse_mode: 'Markdown',
      ...buildIntervalKeyboard(value)
    }
  );
}

async function intervalInfoAction(ctx) {
  await ctx.answerCbQuery();
  await ctx.reply(
    '❕ *Interval nima?*\n\n' +
    'Interval — bu bot bir guruhga xabar yuborgandan keyingi *kutish vaqti*.\n\n' +
    'Masalan, interval 5 daqiqa bo\'lsa, bot har 5 daqiqada bir marta xabar yuboradi.\n\n' +
    '⚠️ Juda kam interval akkauntingiz ban yeyishiga olib kelishi mumkin!',
    { parse_mode: 'Markdown' }
  );
}

const intervalManualScene = new Scenes.WizardScene(
  'INTERVAL_MANUAL',

  async (ctx) => {
    await ctx.reply(
      '✍️ *Intervalingizni kiriting (daqiqada):*\n\n' +
      'Masalan: `45` (45 daqiqa)\n' +
      'Minimal: 2 daqiqa\n' +
      'Maksimal: 1440 daqiqa (24 soat)',
      {
        parse_mode: 'Markdown',
        ...rawInline([[iBtn('❌ Bekor qilish', 'cancel_manual', 'danger')]])
      }
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (ctx.callbackQuery?.data === 'cancel_manual') {
      await ctx.answerCbQuery();
      await ctx.scene.leave();
      return intervalHandler(ctx);
    }

    const input = parseInt(ctx.message?.text?.trim());
    if (isNaN(input) || input < 2 || input > 1440) {
      await ctx.reply('⚠️ 2 dan 1440 gacha son kiriting:');
      return;
    }

    const seconds = input * 60;
    await User.findOneAndUpdate(
      { userId: ctx.from.id },
      { interval: seconds },
      { upsert: true }
    );

    await ctx.reply(
      `✅ Interval *${input} daqiqa* ga o'rnatildi!`,
      { parse_mode: 'Markdown' }
    );
    await ctx.scene.leave();
    return intervalHandler(ctx);
  }
);

intervalManualScene.action('cancel_manual', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.scene.leave();
});

module.exports = {
  intervalHandler,
  setIntervalAction,
  intervalInfoAction,
  intervalManualScene
};
