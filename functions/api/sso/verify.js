import { json, err, readJson } from '../../../lib/http.js';
import { createSession, sessionCookie } from '../../../lib/auth.js';
// WOAIL SSO (optional). Configure WOAIL_VERIFY_URL + WOAIL_SECRET.
// The verify endpoint is expected to accept { ticket } and return
// { ok: true, email: "user@woail.example" } on success.
// If WOAIL is not configured, this endpoint honestly reports that.
async function verifyTicket(env, ticket) {
  if (!env.WOAIL_VERIFY_URL) return null;
  const res = await fetch(env.WOAIL_VERIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(env.WOAIL_SECRET ? { Authorization: `Bearer ${env.WOAIL_SECRET}` } : {}) },
    body: JSON.stringify({ ticket }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok || !data.email) throw new Error(data.error || data.message || 'WOAIL ID 校验失败。');
  return data.email;
}
export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return err('只支持 POST。', 405);
  if (!env.DB) return err('数据库未绑定（DB）', 500);
  const body = await readJson(request);
  if (body === null || !body.ticket) return err('缺少 ticket');
  if (!env.WOAIL_VERIFY_URL) return json({ ok: false, error: 'WOAIL SSO 未配置' }, 503);
  let email;
  try { email = await verifyTicket(env, body.ticket); } catch (e) { return err(e.message, 401); }
  const binding = await env.DB.prepare('SELECT user_id FROM sso_bindings WHERE provider = ? AND provider_email = ?')
    .bind('woail', email).first();
  if (binding) {
    const user = await env.DB.prepare('SELECT id, username, email FROM users WHERE id = ?').bind(binding.user_id).first();
    if (user) {
      const token = await createSession(env, user.id);
      return json({ ok: true, bound: true, user }, 200, { 'Set-Cookie': sessionCookie(token, request) });
    }
  }
  return json({ ok: true, bound: false, need_bind: true, email });
}
