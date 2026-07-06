/**
 * styledKb.js — Bot API 9.4 rang tugmalari uchun helper
 *
 * Telegraf v4 ning Markup.inlineKeyboard() va Markup.keyboard() funksiyalari
 * style maydonini qurishda olib tashlaydi. Shuning uchun raw reply_markup
 * obyektini to'g'ridan-to'g'ri ctx.reply() ga uzatamiz.
 *
 * Foydalanish:
 *   const { iBtn, rawInline, rawReply } = require('./styledKb');
 *
 *   // Inline keyboard:
 *   ctx.reply('Matn', rawInline([
 *     [iBtn('🟢 Boshlash', 'start_cb', 'success'), iBtn('🔴 Toxtatish', 'stop_cb', 'danger')],
 *     [iBtn('🔵 Info', 'info_cb', 'primary')]
 *   ]));
 *
 *   // Reply keyboard:
 *   ctx.reply('Menyu', rawReply([
 *     [rBtn('🚀 Habar', 'success'), rBtn('✏️ Matn', 'success')],
 *     [rBtn('⚙️ Sozlash', 'primary')]
 *   ]));
 */

// ─── Inline tugma ─────────────────────────────────────────────────────────────
// style: 'primary' (ko'k) | 'danger' (qizil) | 'success' (yashil) | undefined
function iBtn(text, callback_data, style) {
  const btn = { text, callback_data };
  if (style) btn.style = style;
  return btn;
}

// URL tugmasi (rang qo'llab-quvvatlanmaydi, lekin struktura bir xil)
function iUrl(text, url) {
  return { text, url };
}

// Inline keyboard raw reply_markup obyekti
function rawInline(rows) {
  return { reply_markup: { inline_keyboard: rows } };
}

// ─── Reply (keyboard) tugma ───────────────────────────────────────────────────
function rBtn(text, style) {
  const btn = { text };
  if (style) btn.style = style;
  return btn;
}

// Reply keyboard raw reply_markup obyekti
function rawReply(rows, { resize = true, one_time = false } = {}) {
  return {
    reply_markup: {
      keyboard: rows,
      resize_keyboard: resize,
      one_time_keyboard: one_time
    }
  };
}

module.exports = { iBtn, iUrl, rawInline, rBtn, rawReply };
