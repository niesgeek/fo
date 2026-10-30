import { json, err } from '../../../lib/http.js';
import { getSessionUser } from '../../../lib/auth.js';
export async function onRequest({ request, env }) {
  if (!env.DB) return err('数据库未绑定（DB）', 500);
  const user = await getSessionUser(env, request);
  if (!user) return err('未登录。', 401);
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();
  const limit = Math.min(80, Math.max(1, parseInt(url.searchParams.get('limit') || '80', 10) || 80));
  if (!q) return json({ ok: true, messages: [] });
  const like = `%${q}%`;
  const rows = await env.DB.prepare('SELECT id, resend_id, direction, from_addr, to_json, subject, snippet, received_at, created_at, is_read, is_starred FROM messages WHERE user_id = ? AND is_deleted = 0 AND (subject LIKE ? OR from_addr LIKE ? OR snippet LIKE ? OR text_body LIKE ?) ORDER BY received_at DESC LIMIT ?')
    .bind(user.id, like, like, like, like, limit).all();
  const messages = (rows.results || []).map((m) => ({ ...m, to: JSON.parse(m.to_json || '[]'), read: Boolean(m.is_read), starred: Boolean(m.is_starred) }));
  return json({ ok: true, messages });
}
