import { json, err } from '../../../lib/http.js';
import { getSessionUser } from '../../../lib/auth.js';
// GET /api/mail/inbox?folder=inbox|sent|starred|archived|spam|trash&limit=50&offset=0
export async function onRequest({ request, env }) {
  if (!env.DB) return err('数据库未绑定（DB）', 500);
  const user = await getSessionUser(env, request);
  if (!user) return err('未登录。', 401);
  const url = new URL(request.url);
  const folder = url.searchParams.get('folder') || 'inbox';
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10) || 50));
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
  let where = 'user_id = ? AND is_deleted = 0';
  const params = [user.id];
  if (folder === 'sent') { where += ' AND direction = ?'; params.push('out'); }
  else if (folder === 'starred') { where += ' AND is_starred = 1 AND is_trashed = 0 AND is_spam = 0'; }
  else if (folder === 'archived') { where += ' AND is_archived = 1 AND is_trashed = 0'; }
  else if (folder === 'spam') { where += ' AND is_spam = 1 AND is_trashed = 0'; }
  else if (folder === 'trash') { where += ' AND is_trashed = 1'; }
  else { where += " AND direction = 'in' AND is_archived = 0 AND is_spam = 0 AND is_trashed = 0"; }
  const rows = await env.DB.prepare(`SELECT id, resend_id, direction, from_addr, to_json, subject, snippet, received_at, created_at, is_read, is_starred, is_archived, is_spam, is_trashed FROM messages WHERE ${where} ORDER BY received_at DESC, created_at DESC LIMIT ? OFFSET ?`)
    .bind(...params, limit, offset).all();
  const total = await env.DB.prepare(`SELECT COUNT(*) AS n FROM messages WHERE ${where}`).bind(...params).first();
  const messages = (rows.results || []).map((m) => ({
    ...m,
    to: JSON.parse(m.to_json || '[]'),
    read: Boolean(m.is_read), starred: Boolean(m.is_starred),
  }));
  const addresses = [user.email];
  const aliases = await env.DB.prepare('SELECT alias_email FROM aliases WHERE user_id = ?').bind(user.id).all();
  for (const a of aliases.results || []) addresses.push(a.alias_email);
  return json({ ok: true, messages, total: total?.n || 0, addresses });
}
