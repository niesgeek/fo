import { json, err, readJson, parseAddressList, isEmail, userEmail } from '../../../lib/http.js';
import { getSessionUser } from '../../../lib/auth.js';
import { resendSend } from '../../../lib/resend.js';
export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return err('只支持 POST。', 405);
  if (!env.DB) return err('数据库未绑定（DB）', 500);
  const user = await getSessionUser(env, request);
  if (!user) return err('未登录。', 401);
  if (!env.RESEND_API_KEY) return err('邮件发送未配置：请设置 RESEND_API_KEY', 503);
  const body = await readJson(request);
  if (body === null) return err('请求体不是合法 JSON');
  const to = parseAddressList(body.to);
  if (!to.length || !to.every(isEmail)) return err('收件人无效');
  // from must be the user's own address or one of their aliases
  let from = String(body.from || user.email);
  if (from !== user.email) {
    const a = await env.DB.prepare('SELECT id FROM aliases WHERE user_id = ? AND alias_email = ?').bind(user.id, from).first();
    if (!a) return err('发件身份不是你的地址或别名', 403);
  }
  const subject = String(body.subject || '');
  const text = body.text ? String(body.text) : undefined;
  const html = body.html ? String(body.html) : undefined;
  if (!text && !html) return err('正文不能为空');
  let attachments = [];
  if (Array.isArray(body.attachments)) {
    attachments = body.attachments.filter((a) => a && a.filename && a.content).map((a) => ({ filename: a.filename, content: a.content, content_type: a.content_type }));
  }
  // Forward with attachments: the frontend sends forwardAttachments=<messageId>;
  // the server fetches that message's attachments from Resend instead of
  // asking the browser to download them (Resend S3 links have no CORS headers).
  if (body.forwardAttachments) {
    const orig = await env.DB.prepare('SELECT resend_id FROM messages WHERE id = ? AND user_id = ?').bind(body.forwardAttachments, user.id).first();
    if (orig?.resend_id) {
      const atts = await env.DB.prepare('SELECT resend_attachment_id, filename, content_type FROM attachments WHERE message_id = ?').bind(body.forwardAttachments).all();
      for (const at of atts.results || []) {
        if (!at.resend_attachment_id) continue;
        try {
          const r = await fetch(`https://api.resend.com/emails/${encodeURIComponent(orig.resend_id)}/attachments/${encodeURIComponent(at.resend_attachment_id)}`, { headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` } });
          const d = await r.json().catch(() => ({}));
          if (d.content) attachments.push({ filename: at.filename, content: d.content, content_type: at.content_type });
        } catch { /* skip one attachment rather than failing the whole send */ }
      }
    }
  }
  let sent;
  try {
    sent = await resendSend(env, { from, to, cc: body.cc, bcc: body.bcc, replyTo: body.reply_to, subject, text, html, attachments });
  } catch (e) { return err(e.message, 502); }
  const id = crypto.randomUUID();
  const now = Date.now();
  const snippet = (text || '').replace(/\s+/g, ' ').slice(0, 200);
  await env.DB.prepare('INSERT INTO messages (id, user_id, resend_id, direction, from_addr, to_json, cc_json, subject, snippet, text_body, html_body, received_at, created_at, is_read) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)')
    .bind(id, user.id, sent.id || null, 'out', from, JSON.stringify(to), JSON.stringify(parseAddressList(body.cc)), subject, snippet, text || '', html || '', now, now).run();
  return json({ ok: true, id: sent.id });
}
