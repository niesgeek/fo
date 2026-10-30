import { json, err } from '../../lib/http.js';
import { getSessionUser } from '../../lib/auth.js';
export async function onRequest({ request, env }) {
  if (!env.DB) return err('数据库未绑定（DB）', 500);
  const user = await getSessionUser(env, request);
  if (!user) return err('未登录。', 401);
  return json({ ok: true, user });
}
