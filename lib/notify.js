// Optional Telegram notification for new mail. No-op when not configured.
export async function notifyTelegram(env, userId, text) {
  try {
    const row = await env.DB.prepare('SELECT telegram_chat_id, telegram_enabled FROM notify_settings WHERE user_id = ?')
      .bind(userId).first();
    if (!row || !row.telegram_enabled || !row.telegram_chat_id) return false;
    if (!env.TELEGRAM_BOT_TOKEN) return false;
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: row.telegram_chat_id, text }),
    });
    return true;
  } catch {
    return false;
  }
}
