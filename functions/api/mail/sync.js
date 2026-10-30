import { json, err, extractAddresses } from '../../../lib/http.js';
import { getSessionUser } from '../../../lib/auth.js';
import { resendListReceived, resendGetReceived } from '../../../lib/resend.js';
import { notifyTelegram } from '../../../lib/notify.js';
// GET /api/mail/sync?batch=3
// Pulls inbound mail from Resend in small batches (the original product
// did the same to stay under Workers CPU limits and Resend rate limits).
// Each message is routed to the user whose address (or alias) it was sent to.
export async function onRequest({ request, env }) {
  if (!env.DB) return err('数据库未绑定（DB）', 500);
  const user = await getSessionUser(env, request);
  if (!user) return err('未登录。', 401);
  if (!env.RESEND_API_KEY) return err('同步未配置：请设置 RESEND_API_KEY 并在 Resend 开启收信', 503);
  const batch = Math.min(20, Math.max(1, parseInt(new URL(request.url).searchParams.get('batch') || '3', 10) || 3));
  let list;
  try { list = await resendListReceived(env, 50); } catch (e) { return err(e.message, 502); }
  const items = list.data || list.emails || [];
  let synced = 0, done = false;
  for (const item of items.slice(0, batch)) {
    const resendId = item.id;
    const exists = await env.DB.prepare('SELECT id FROM messages WHERE resend_id = ?').bind(resendId).first();
    if (exists) { done = true; continue; }
    let full;
    try { full = await resendGetReceived(env, resendId); } catch { continue; }
    const toList = extractAddresses(full.to || full.recipients || item.to);
    const allAddresses = [...toList];
    // Find the owner: main address first, then aliases.
    let owner = null;
    for (const addr of allAddresses) {
      owner = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(addr.toLowerCase()).first();
      if (owner) break;
      const al = await env.DB.prepare('SELECT user_id FROM aliases WHERE alias_email = ?').bind(addr.toLowerCase()).first();
      if (al) { owner = { id: al.user_id }; break; }
    }
    if (!owner) continue;
    const text = full.text || full.body || '';
    const html = full.html || '';
    const snippet = String(text || html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').slice(0, 200);
    const id = crypto.randomUUID();
    const receivedAt = full.created_at ? Date.parse(full.created_at) : Date.now();
    await env.DB.prepare('INSERT INTO messages (id, user_id, resend_id, direction, from_addr, to_json, cc_json, subject, snippet, text_body, html_body, received_at, created_at, is_read) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)')
      .bind(id, owner.id, resendId, 'in', typeof full.from === 'string' ? full.from : (full.from?.email || ''), JSON.stringify(toList), JSON.stringify(extractAddresses(full.cc)), full.subject || '', snippet, text, html, receivedAt, Date.now()).run();
    const atts = full.attachments || [];
    for (const at of atts) {
      await env.DB.prepare('INSERT INTO attachments (id, message_id, resend_attachment_id, filename, content_type, size) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), id, at.id || null, at.filename || 'attachment', at.content_type || null, at.size || null).run();
    }
    synced++;
    if (owner.id === user.id) {
      await notifyTelegram(env, user.id, `新邮件：${full.subject || '(无主题)'} —— 来自 ${typeof full.from === 'string' ? full.from : (full.from?.email || '')}`);
    }
  }
  return json({ ok: true, synced, done });
}
