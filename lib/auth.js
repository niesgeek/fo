// Auth: PBKDF2 password hashing + opaque session tokens stored hashed in D1.
// Works in the Workers runtime (crypto.subtle). No password is stored in clear text.
import { sha256Hex, randomHex, parseCookies } from './http.js';

export async function hashPassword(password, saltHex) {
  const salt = saltHex
    ? Uint8Array.from(saltHex.match(/../g).map((h) => parseInt(h, 16)))
    : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    key,
    256,
  );
  const hashHex = [...new Uint8Array(bits)].map((x) => x.toString(16).padStart(2, '0')).join('');
  const saltOut = [...salt].map((x) => x.toString(16).padStart(2, '0')).join('');
  return { salt: saltOut, hash: hashHex };
}
export async function verifyPassword(password, saltHex, hashHex) {
  const r = await hashPassword(password, saltHex);
  return r.hash === hashHex;
}
export function sessionCookie(token, request, maxAge = 30 * 24 * 3600) {
  const secure = new URL(request.url).protocol === 'https:';
  return `session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
export function clearSessionCookie(request) {
  const secure = new URL(request.url).protocol === 'https:';
  return `session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure ? '; Secure' : ''}`;
}
export async function createSession(env, userId) {
  const token = randomHex(32);
  const tokenHash = await sha256Hex(token + (env.SESSION_SECRET || ''));
  const expires = Date.now() + 30 * 24 * 3600 * 1000;
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .bind(tokenHash, userId, expires, Date.now()).run();
  return token;
}
export async function getSessionUser(env, request) {
  const token = parseCookies(request).session;
  if (!token) return null;
  const tokenHash = await sha256Hex(token + (env.SESSION_SECRET || ''));
  const s = await env.DB.prepare('SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?')
    .bind(tokenHash, Date.now()).first();
  if (!s) return null;
  const u = await env.DB.prepare('SELECT id, username, email, role, created_at FROM users WHERE id = ?')
    .bind(s.user_id).first();
  return u || null;
}
export async function requireAuth(env, request) {
  const user = await getSessionUser(env, request);
  return user;
}
