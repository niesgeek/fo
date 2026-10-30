import { json, err } from '../../../lib/http.js';
import { getSessionUser } from '../../../lib/auth.js';
export async function onRequest({ request, env }) {
  if (!env.DB) return err('数据库未绑定（DB）', 500);
  const user = await getSessionUser(env, request);
  if (!user) return err('未登录。', 401);
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return err('缺少 id');
  const m = await env.DB.prepare('SELECT * FROM messages WHERE id = ? AND user_id = ?').bind(id, user.id).first();
  if (!m) return err('邮件不存在', 404);
  const atts = await env.DB.prepare('SELECT id, filename, content_type, size FROM attachments WHERE message_id = ?').bind(id).all();
  return json({
    ok: true,
    message: {
      ...m,
      to: JSON.parse(m.to_json || '[]'), cc: JSON.parse(m.cc_json || '[]'),
      read: Boolean(m.is_read), starred: Boolean(m.is_starred),
      attachments: atts.results || [],
    },
  });
}
