import { json, err, readJson } from '../../../lib/http.js';
import { getSessionUser } from '../../../lib/auth.js';
export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return err('只支持 POST。', 405);
  if (!env.DB) return err('数据库未绑定（DB）', 500);
  const user = await getSessionUser(env, request);
  if (!user) return err('未登录。', 401);
  const body = await readJson(request);
  if (body === null || !body.email) return err('缺少已验证的 WOAIL 邮箱');
  // The frontend must only call this after /api/sso/verify returned need_bind
  // for this email in the same browser session. We do not re-verify here
  // because WOAIL tickets are single-use; verify+bind in production should
  // be a single server-side step if your WOAIL provider supports it.
  await env.DB.prepare('INSERT OR REPLACE INTO sso_bindings (provider, provider_email, user_id, created_at) VALUES (?, ?, ?, ?)')
    .bind('woail', String(body.email).toLowerCase(), user.id, Date.now()).run();
  return json({ ok: true });
}
