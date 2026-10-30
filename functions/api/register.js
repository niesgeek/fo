import { json, err, readJson, isValidUsername, userEmail } from '../../lib/http.js';
import { hashPassword, createSession, sessionCookie } from '../../lib/auth.js';
export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return err('只支持 POST。', 405);
  if (!env.DB) return err('数据库未绑定（DB）', 500);
  const body = await readJson(request);
  if (body === null) return err('请求体不是合法 JSON');
  const username = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!isValidUsername(username)) return err('账号名只允许 3-32 位小写字母、数字、_ . -');
  if (password.length < 8) return err('密码至少 8 位');
  if (env.INVITE_CODE && body.invite !== env.INVITE_CODE) return err('邀请码不正确', 403);
  const existing = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
  if (existing) return err('账号名已被占用', 409);
  const email = userEmail(username, env);
  const { salt, hash } = await hashPassword(password);
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO users (id, username, email, password_salt, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, username, email, salt, hash, 'user', Date.now()).run();
  const token = await createSession(env, id);
  return json({ ok: true, email, user: { id, username, email } }, 200, { 'Set-Cookie': sessionCookie(token, request) });
}
