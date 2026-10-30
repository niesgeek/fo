import { json, err, readJson } from '../../lib/http.js';
import { getSessionUser } from '../../lib/auth.js';
import { chatCompletion } from '../../lib/ai.js';
export async function onRequest({ request, env }) {
  if (!env.DB) return err('数据库未绑定（DB）', 500);
  const user = await getSessionUser(env, request);
  if (!user) return err('未登录。', 401);
  const url = new URL(request.url);
  if (request.method === 'GET') {
    const convId = url.searchParams.get('conversation_id');
    if (convId) {
      const msgs = await env.DB.prepare('SELECT role, content, created_at FROM chat_messages WHERE conversation_id = ? AND user_id = ? ORDER BY created_at ASC')
        .bind(convId, user.id).all();
      return json({ ok: true, messages: msgs.results || [] });
    }
    const convs = await env.DB.prepare('SELECT id, title, created_at, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50')
      .bind(user.id).all();
    return json({ ok: true, conversations: convs.results || [] });
  }
  if (request.method !== 'POST') return err('只支持 POST 或 GET。', 405);
  if (!env.AI_API_KEY) return err('AI 未配置：请设置 AI_API_KEY（以及可选的 AI_API_BASE / AI_MODEL）', 503);
  const body = await readJson(request);
  if (body === null || !body.message) return err('缺少 message');
  let convId = body.conversation_id;
  if (!convId) {
    convId = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO conversations (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .bind(convId, user.id, String(body.message).slice(0, 40), Date.now(), Date.now()).run();
  }
  const history = await env.DB.prepare('SELECT role, content FROM chat_messages WHERE conversation_id = ? AND user_id = ? ORDER BY created_at ASC LIMIT 40')
    .bind(convId, user.id).all();
  const messages = [...(history.results || []).map((m) => ({ role: m.role, content: m.content })), { role: 'user', content: String(body.message) }];
  let reply;
  try { reply = await chatCompletion(env, messages); } catch (e) { return err(e.message, 502); }
  const now = Date.now();
  await env.DB.prepare('INSERT INTO chat_messages (id, conversation_id, user_id, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), convId, user.id, 'user', String(body.message), now).run();
  await env.DB.prepare('INSERT INTO chat_messages (id, conversation_id, user_id, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), convId, user.id, 'assistant', reply, now + 1).run();
  await env.DB.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').bind(now, convId).run();
  return json({ ok: true, conversation_id: convId, reply });
}
