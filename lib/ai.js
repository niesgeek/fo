// OpenAI-compatible chat completions proxy.
// Configure AI_API_BASE (default https://api.openai.com/v1),
// AI_API_KEY and AI_MODEL. No provider is hard-coded as "the" provider.
export async function chatCompletion(env, messages) {
  const base = (env.AI_API_BASE || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = env.AI_MODEL || 'gpt-4o-mini';
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.AI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || data.message || `AI request failed (${res.status})`);
  return data.choices?.[0]?.message?.content || '';
}
