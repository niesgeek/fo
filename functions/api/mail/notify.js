import { json, err, readJson } from '../../../lib/http.js';
import { getSessionUser } from '../../../lib/auth.js';
export async function onRequest({ request, env }) {
  if (!env.DB) return err('数据库未绑定（DB）', 500);
  const user = await getSessionUser(env, request);
  if (!user) return err('未登录。', 401);
  if (request.method === 'GET') {
    const row = await env.DB.prepare('SELECT telegram_chat_id, telegram_enabled FROM notify_settings WHERE user_id = ?').bind(user.id).first();
    return json({ ok: true, telegram_chat_id: row?.telegram_chat_id || null, telegram_enabled: Boolean(row?.telegram_enabled) });
  }
  if (request.method !== 'POST') return err('只支持 GET 或 POST。', 405);
  const body = await readJson(request);
  if (body === null) return err('请求体不是合法 JSON');
  if (body.action === 'test') {
    const chat = body.tg_chat || body.telegram_chat_id;
    if (!chat) return err('缺少 Telegram chat id');
    if (!env.TELEGRAM_BOT_TOKEN) return err('Telegram 未配置：请设置 TELEGRAM_BOT_TOKEN', 503);
    const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: '这是一封测试通知：新邮件提醒已接通。' }),
    });
    if (!r.ok) return err('Telegram 发送失败', 502);
    return json({ ok: true });
  }
  const chat = body.tg_chat ?? body.telegram_chat_id ?? null;
  const enabled = body.enabled !== undefined ? (body.enabled ? 1 : 0) : 1;
  await env.DB.prepare('INSERT INTO notify_settings (user_id, telegram_chat_id, telegram_enabled, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET telegram_chat_id = excluded.telegram_chat_id, telegram_enabled = excluded.telegram_enabled, updated_at = excluded.updated_at')
    .bind(user.id, chat, enabled, Date.now()).run();
  return json({ ok: true });
}
