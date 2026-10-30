import { json, err, readJson, mailDomain, isEmail } from '../../../lib/http.js';
import { getSessionUser } from '../../../lib/auth.js';
export async function onRequest({ request, env }) {
  if (!env.DB) return err('数据库未绑定（DB）', 500);
  const user = await getSessionUser(env, request);
  if (!user) return err('未登录。', 401);
  if (request.method === 'GET') {
    const rows = await env.DB.prepare('SELECT id, alias_email, created_at FROM aliases WHERE user_id = ? ORDER BY created_at ASC').bind(user.id).all();
    return json({ ok: true, aliases: rows.results || [] });
  }
  if (request.method !== 'POST') return err('只支持 GET 或 POST。', 405);
  const body = await readJson(request);
  if (body === null) return err('请求体不是合法 JSON');
  if (body.action === 'delete' && body.id) {
    await env.DB.prepare('DELETE FROM aliases WHERE id = ? AND user_id = ?').bind(body.id, user.id).run();
    return json({ ok: true });
  }
  const alias = String(body.alias || body.alias_email || '').trim().toLowerCase();
  if (!isEmail(alias)) return err('别名不是合法邮箱');
  const domain = mailDomain(env);
  if (domain && !alias.endsWith(`@${domain}`)) return err('别名必须使用本站域名');
  if (alias === user.email) return err('别名不能就是主地址');
  await env.DB.prepare('INSERT OR IGNORE INTO aliases (id, user_id, alias_email, created_at) VALUES (?, ?, ?, ?)')
    .bind(crypto.randomUUID(), user.id, alias, Date.now()).run();
  return json({ ok: true, alias });
}
