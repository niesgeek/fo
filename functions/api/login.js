import { json, err, readJson } from '../../lib/http.js';
import { verifyPassword, createSession, sessionCookie } from '../../lib/auth.js';
export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return err('只支持 POST。', 405);
  if (!env.DB) return err('数据库未绑定（DB）', 500);
  const body = await readJson(request);
  if (body === null) return err('请求体不是合法 JSON');
  const username = String(body.username || body.account || '').trim().toLowerCase();
  const password = String(body.password || '');
  const user = await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first();
  if (!user || !(await verifyPassword(password, user.password_salt, user.password_hash))) {
    return err('账号或密码不正确', 401);
  }
  // If a WOAIL ticket was pending, the frontend should call /api/sso/bind after login.
  const token = await createSession(env, user.id);
  return json({ ok: true, user: { id: user.id, username: user.username, email: user.email } }, 200, { 'Set-Cookie': sessionCookie(token, request) });
}
