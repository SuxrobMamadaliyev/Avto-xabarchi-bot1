const { Markup } = require('telegraf');
const { Scenes } = require('telegraf');
const User = require('./User');

// Interval variantlari (soniyada)
const INTERVALS = [
  { label: '2daq',    value: 120 },
  { label: '3daq',    value: 180 },
  { label: '4daq',    value: 240 },
  { label: '5daq',    value: 300 },
  { label: '6daq',    value: 360 },
  { label: '7daq',    value: 420 },
  { label: '8daq',    value: 480 },
  { label: '9daq',    value: 540 },
  { label: '10daq',   value: 600 },
  { label: '11daq',   value: 660 },
  { label: '12daq',   value: 720 },
  { label: '13daq',   value: 780 },
  { label: '14daq',   value: 840 },
  { label: '15daq',   value: 900 },
  { label: '30daq',   value: 1800 },
  { label: '1 soat',  value: 3600 },
  { label: '1.5 soat',value: 5400 },
  { label: '2 soat',  value: 7200 },
  { label: '3 soat',  value: 10800 },
];

function formatInterval(seconds) {
  if (seconds < 3600) return `${seconds / 60} daqiqa`;
  return `${seconds / 3600} soat`;
}

function buildIntervalKeyboard(currentInterval) {
  // 5 ta qator, har birida 5 ta tugma
  const rows = [];

  // 1-qator: 2-6 daqiqa
  rows.push(
    INTERVALS.slice(0, 5).map(i =>
      Markup.button.callback(
        (i.value === currentInterval ? '✔️ ' : '') + i.label,
        `set_interval_${i.value}`
      )
    )
  );
  // 2-qator: 7-11 daqiqa
  rows.push(
    INTERVALS.slice(5, 10).map(i =>
      Markup.button.callback(
        (i.value === currentInterval ? '✔️ ' : '') + i.label,
        `set_interval_${i.value}`
      )
    )
  );
  // 3-qator: 12-15 daqiqa
  rows.push(
    INTERVALS.slice(10, 14).map(i =>
      Markup.button.callback(
        (i.value === currentInterval ? '✔️ ' : '') + i.label,
        `set_interval_${i.value}`
      )
    )
  );
  // 4-qator: 30daq, 1 soat, 1.5 soat, 2 soat, 3 soat
  rows.push(
    INTERVALS.slice(14).map(i =>
      Markup.button.callback(
        (i.value === currentInterval ? '✔️ ' : '') + i.label,
        `set_interval_${i.value}`
      )
    )
  );
  // Pastki tugmalar
  rows.push([Markup.button.callback('❕ Interval nima', 'interval_info')]);
  rows.push([Markup.button.callback('✍️ Qo\'lda kiritish', 'interval_manual')]);
  rows.push([Markup.button.callback('⬅️ Orqaga', 'main_menu')]);

  return Markup.inlineKeyboard(rows);
}

async function intervalHandler(ctx) {
  const user = await User.findOne({ userId: ctx.from.id });
  const current = user?.interval || 300; // default 5 daqiqa

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

// Intervalga bosish
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

// Interval nima?
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

// Qo'lda kiritish scene
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
        ...Markup.inlineKeyboard([
          [Markup.button.callback('❌ Bekor qilish', 'cancel_manual')]
        ])
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
