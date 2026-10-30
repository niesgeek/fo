import { json, err, extractAddresses, b64decode } from '../../../lib/http.js';
import { resendGetReceived } from '../../../lib/resend.js';
import { notifyTelegram } from '../../../lib/notify.js';
// POST /api/webhooks/resend  (Resend webhook, Svix-signed when configured)
// Security: the webhook payload is only used to learn an email id.
// The full message is always fetched from Resend with the API key,
// so a forged payload cannot inject arbitrary mail content.
async function verifySvix(env, request, raw) {
  const secret = env.RESEND_WEBHOOK_SECRET;
  if (!secret) return true;
  const id = request.headers.get('svix-id');
  const ts = request.headers.get('svix-timestamp');
  const sig = request.headers.get('svix-signature');
  if (!id || !ts || !sig) return false;
  const keyB64 = secret.replace(/^whsec_/, '');
  const key = b64decode(keyB64);
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(`${id}.${ts}.${raw}`));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return sig.split(' ').some((part) => part === `v1,${expected}`);
}
export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return err('只支持 POST。', 405);
  if (!env.DB) return err('数据库未绑定（DB）', 500);
  const raw = await request.text();
  if (!(await verifySvix(env, request, raw))) return err('签名校验失败', 401);
  let body;
  try { body = JSON.parse(raw); } catch { return err('请求体不是合法 JSON'); }
  const type = body.type || body.event || '';
  const data = body.data || {};
  if (!String(type).includes('email.received') && type !== 'email.received') {
    // Delivery/open/click events are accepted but need no inbox action.
    return json({ ok: true, ignored: true });
  }
  const emailId = data.email_id || data.id;
  if (!emailId) return err('缺少 email_id');
  if (!env.RESEND_API_KEY) return err('Resend 未配置', 503);
  let full;
  try { full = await resendGetReceived(env, emailId); } catch (e) { return err(e.message, 502); }
  const toList = extractAddresses(full.to || full.recipients);
  let owner = null;
  for (const addr of toList) {
    owner = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(addr.toLowerCase()).first();
    if (owner) break;
    const al = await env.DB.prepare('SELECT user_id FROM aliases WHERE alias_email = ?').bind(addr.toLowerCase()).first();
    if (al) { owner = { id: al.user_id }; break; }
  }
  if (!owner) return json({ ok: true, skipped: 'no matching user' });
  const exists = await env.DB.prepare('SELECT id FROM messages WHERE resend_id = ?').bind(emailId).first();
  if (exists) return json({ ok: true, duplicate: true });
  const text = full.text || '';
  const html = full.html || '';
  const snippet = String(text || html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').slice(0, 200);
  const id = crypto.randomUUID();
  const receivedAt = full.created_at ? Date.parse(full.created_at) : Date.now();
  await env.DB.prepare('INSERT INTO messages (id, user_id, resend_id, direction, from_addr, to_json, cc_json, subject, snippet, text_body, html_body, received_at, created_at, is_read) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)')
    .bind(id, owner.id, emailId, 'in', typeof full.from === 'string' ? full.from : (full.from?.email || ''), JSON.stringify(toList), JSON.stringify(extractAddresses(full.cc)), full.subject || '', snippet, text, html, receivedAt, Date.now()).run();
  for (const at of full.attachments || []) {
    await env.DB.prepare('INSERT INTO attachments (id, message_id, resend_attachment_id, filename, content_type, size) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), id, at.id || null, at.filename || 'attachment', at.content_type || null, at.size || null).run();
  }
  await notifyTelegram(env, owner.id, `新邮件：${full.subject || '(无主题)'}`);
  return json({ ok: true, message_id: id });
}
