import { json, err, readJson } from '../../../lib/http.js';
import { getSessionUser } from '../../../lib/auth.js';
// POST { id | ids, field: read|star|hide|spam|delete|restore|purge, on: boolean }
// hide = archived, delete = trash, restore = back to inbox, purge = local permanent hide
const FIELD_MAP = { read: 'is_read', star: 'is_starred', hide: 'is_archived', spam: 'is_spam', delete: 'is_trashed' };
export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return err('只支持 POST。', 405);
  if (!env.DB) return err('数据库未绑定（DB）', 500);
  const user = await getSessionUser(env, request);
  if (!user) return err('未登录。', 401);
  const body = await readJson(request);
  if (body === null) return err('请求体不是合法 JSON');
  const ids = body.ids || (body.id ? [body.id] : []);
  if (!ids.length) return err('缺少 id');
  const on = body.on !== false;
  for (const id of ids) {
    if (body.field === 'restore') {
      await env.DB.prepare('UPDATE messages SET is_trashed = 0, is_spam = 0, is_archived = 0 WHERE id = ? AND user_id = ?').bind(id, user.id).run();
    } else if (body.field === 'purge') {
      // Local permanent hide only, matching the original product note:
      // the copy held by the mail provider follows its own retention policy.
      await env.DB.prepare('UPDATE messages SET is_deleted = 1 WHERE id = ? AND user_id = ?').bind(id, user.id).run();
    } else {
      const col = FIELD_MAP[body.field];
      if (!col) return err('未知 field');
      await env.DB.prepare(`UPDATE messages SET ${col} = ? WHERE id = ? AND user_id = ?`).bind(on ? 1 : 0, id, user.id).run();
    }
  }
  return json({ ok: true });
}
