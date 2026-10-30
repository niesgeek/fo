// Minimal Resend client (https://api.resend.com).
// Endpoints used (see Resend docs):
//  POST /emails            send
//  GET  /emails/{id}       sent email details
//  GET  /emails/receiving  inbound list (when receiving is enabled)
//  GET  /emails/receiving/{id}  inbound details
//  GET  /emails/{id}/attachments/{attachmentId}  attachment details
import { parseAddressList } from './http.js';

function headers(env) {
  return { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' };
}
export async function resendSend(env, { from, to, cc, bcc, replyTo, subject, text, html, attachments }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify({
      from,
      to: parseAddressList(to),
      cc: parseAddressList(cc),
      bcc: parseAddressList(bcc),
      reply_to: parseAddressList(replyTo),
      subject: subject || '',
      text: text || undefined,
      html: html || undefined,
      attachments: (attachments || []).map((a) => ({
        filename: a.filename,
        content: a.content, // base64
        content_type: a.content_type,
      })),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Resend send failed (${res.status})`);
  return data; // { id }
}
export async function resendGetReceived(env, id) {
  const res = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(id)}`, { headers: headers(env) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Resend get received failed (${res.status})`);
  return data;
}
export async function resendListReceived(env, limit = 20) {
  const res = await fetch(`https://api.resend.com/emails/receiving?limit=${limit}`, { headers: headers(env) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Resend list received failed (${res.status})`);
  return data; // { data: [...] } or { emails: [...] } depending on API version
}
export async function resendGetAttachment(env, emailId, attachmentId) {
  const res = await fetch(`https://api.resend.com/emails/${encodeURIComponent(emailId)}/attachments/${encodeURIComponent(attachmentId)}`, { headers: headers(env) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Resend attachment failed (${res.status})`);
  return data; // may contain download_url and/or content (base64)
}
export function extractAddresses(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : x.email || '')).filter(Boolean);
  return parseAddressList(v);
}
