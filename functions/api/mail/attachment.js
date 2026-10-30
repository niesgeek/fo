import { err, b64decode } from '../../../lib/http.js';
import { getSessionUser } from '../../../lib/auth.js';
import { resendGetAttachment } from '../../../lib/resend.js';
// GET /api/mail/attachment?id=<messageId>&aid=<attachmentId>
// The server exchanges the attachment id for a download on every request,
// so no signed Resend/S3 link is ever written into a page.
export async function onRequest({ request, env }) {
  if (!env.DB) return err('数据库未绑定（DB）', 500);
  const user = await getSessionUser(env, request);
  if (!user) return err('未登录。', 401);
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  const aid = url.searchParams.get('aid');
  if (!id || !aid) return err('缺少 id 或 aid');
  const m = await env.DB.prepare('SELECT resend_id FROM messages WHERE id = ? AND user_id = ?').bind(id, user.id).first();
  const a = await env.DB.prepare('SELECT * FROM attachments WHERE id = ? AND message_id = ?').bind(aid, id).first();
  if (!m || !a) return err('附件不存在', 404);
  if (!env.RESEND_API_KEY) return err('附件服务未配置：请设置 RESEND_API_KEY', 503);
  if (!m.resend_id || !a.resend_attachment_id) return err('该附件没有可下载的服务端副本', 404);
  let data;
  try { data = await resendGetAttachment(env, m.resend_id, a.resend_attachment_id); } catch (e) { return err(e.message, 502); }
  if (data.download_url) {
    const r = await fetch(data.download_url);
    if (!r.ok) return err('附件下载失败', 502);
    const buf = await r.arrayBuffer();
    return new Response(buf, { headers: { 'Content-Type': a.content_type || 'application/octet-stream', 'Content-Disposition': `attachment; filename="${encodeURIComponent(a.filename)}"` } });
  }
  if (data.content) {
    const bytes = b64decode(data.content);
    return new Response(bytes, { headers: { 'Content-Type': a.content_type || 'application/octet-stream', 'Content-Disposition': `attachment; filename="${encodeURIComponent(a.filename)}"` } });
  }
  return err('Resend 未返回附件内容', 502);
}
