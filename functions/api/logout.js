import { json, err, parseCookies, sha256Hex } from '../../lib/http.js';
import { clearSessionCookie } from '../../lib/auth.js';
export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return err('只支持 POST。', 405);
  if (env.DB) {
    const token = parseCookies(request).session;
    if (token) {
      const h = await sha256Hex(token + (env.SESSION_SECRET || ''));
      await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(h).run();
    }
  }
  return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie(request) });
}
