import { json, err, readJson } from '../../lib/http.js';
import { getSessionUser, hashPassword, verifyPassword } from '../../lib/auth.js';
export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return err('只支持 POST。', 405);
  if (!env.DB) return err('数据库未绑定（DB）', 500);
  const user = await getSessionUser(env, request);
  if (!user) return err('未登录。', 401);
  const body = await readJson(request);
  if (body === null) return err('请求体不是合法 JSON');
  const current = String(body.current || '');
  const next = String(body.next || body.new_password || '');
  if (next.length < 8) return err('新密码至少 8 位');
  const full = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first();
  if (!(await verifyPassword(current, full.password_salt, full.password_hash))) return err('当前密码不正确', 403);
  const { salt, hash } = await hashPassword(next);
  await env.DB.prepare('UPDATE users SET password_salt = ?, password_hash = ? WHERE id = ?').bind(salt, hash, user.id).run();
  return json({ ok: true });
}
